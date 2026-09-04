import { isAxiosError } from "axios";
import { isDeepStrictEqual } from "node:util";
import * as vscode from "vscode";

import { errToStr, extractAllAgents } from "../../api/api-helper";
import { AgentMetadataTracker } from "../../workspace/agentMetadataTracker";
import {
	availableFilters,
	DEFAULT_WORKSPACE_FILTER,
	WORKSPACE_FILTERS,
} from "../../workspace/filters";

import type {
	Workspace,
	WorkspaceFilter,
	WorkspacesState,
	WorkspacesUpdate,
} from "@repo/shared";

import type { AgentMetadataClient } from "../../api/agentMetadataHelper";
import type { CoderApi } from "../../api/coderApi";
import type { SessionState } from "../../deployment/sessionStore";
import type { Logger } from "../../logging/logger";

interface WorkspacesClient extends AgentMetadataClient {
	getWorkspaces(
		request: Parameters<CoderApi["getWorkspaces"]>[0],
	): Promise<{ workspaces: readonly Workspace[] }>;
}

export interface PollOptions {
	/** Delay between polls of a filter that keeps polling. */
	readonly intervalMs: number;
	/** Ceiling for the backed-off delay between retries. */
	readonly maxIntervalMs: number;
}

const DEFAULT_POLL: PollOptions = { intervalMs: 5_000, maxIntervalMs: 60_000 };

/** What a fetch found, or how it failed. */
interface Listed {
	workspaces?: readonly Workspace[];
	loading?: boolean;
	error?: string | null;
}

/**
 * Owns the state the Workspaces panel renders: lists the active filter while
 * visible, watches the agents the panel is showing, and reports what changed.
 */
export class WorkspaceStore implements vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<WorkspacesUpdate>();
	private readonly agents: AgentMetadataTracker;
	private readonly poll: PollOptions;
	private readonly disposables: vscode.Disposable[];
	/** Filters this deployment rejected, so they are no longer offered. */
	private readonly unsupportedFilters = new Set<WorkspaceFilter>();

	public readonly onDidChange = this.changeEmitter.event;

	private filter: WorkspaceFilter = DEFAULT_WORKSPACE_FILTER;
	private workspaces: readonly Workspace[] = [];
	private loading = false;
	private loaded = false;
	private error: string | null = null;
	/** Agents the webview is showing, listed or not. */
	private requestedAgents: readonly string[] = [];
	/** The state as the webview has it, so nothing is pushed twice. */
	private pushed: WorkspacesState | undefined;
	private fetching: vscode.CancellationTokenSource | undefined;
	private fetch = Promise.resolve();
	private nextPoll: NodeJS.Timeout | undefined;
	private retries = 0;
	private visible = false;
	private disposed = false;

	constructor(
		private readonly client: WorkspacesClient,
		private readonly logger: Logger,
		private readonly sessionState: SessionState,
		poll: Partial<PollOptions> = {},
	) {
		this.poll = { ...DEFAULT_POLL, ...poll };
		this.agents = new AgentMetadataTracker(client);
		this.disposables = [
			this.agents,
			this.agents.onDidChange(() => this.update({})),
			this.sessionState.onDidChange(() => this.handleSessionChange()),
		];
	}

	public get state(): WorkspacesState {
		const session = this.sessionState.current;
		return {
			capabilities: {
				authenticated: session.kind === "signedIn",
				filters: availableFilters(session, this.unsupportedFilters),
			},
			workspaces: {
				filter: this.filter,
				workspaces: this.workspaces,
				loading: this.loading,
			},
			metadata: this.agents.metadata,
			error: this.error,
		};
	}

	/** Resolves when the fetch in flight finishes. */
	public get settled(): Promise<void> {
		return this.fetch;
	}

	public findWorkspace(workspaceId: string): Workspace | undefined {
		return this.workspaces.find((workspace) => workspace.id === workspaceId);
	}

	/** Retain cached data while hidden; reuse an in-flight list on reveal. */
	public setVisible(visible: boolean): Promise<void> {
		if (this.disposed || this.visible === visible) {
			return this.fetch;
		}
		this.visible = visible;
		void this.watchListedAgents();
		if (!visible) {
			// Nothing renders while hidden: a short hide reuses the sockets.
			this.cancelPoll();
			return this.fetch;
		}
		return this.fetching ? this.fetch : this.startLoad();
	}

	/** Switch the list, ignoring filters that are not offered. */
	public setFilter(filter: WorkspaceFilter): Promise<void> {
		if (this.disposed || filter === this.filter) {
			return this.fetch;
		}
		if (!this.state.capabilities.filters.includes(filter)) {
			this.logger.warn(`Ignoring unavailable workspaces filter: ${filter}`);
			return this.fetch;
		}
		this.filter = filter;
		this.clearList();
		return this.startLoad();
	}

	/** Watch metadata for these agents only, dropping the rest. */
	public setWatchedAgents(agentIds: readonly string[]): Promise<void> {
		if (this.disposed) {
			return Promise.resolve();
		}
		this.requestedAgents = agentIds;
		return this.watchListedAgents();
	}

	/** Fetch now, offering rejected filters again in case they work now. */
	public refresh(): Promise<void> {
		if (this.disposed) {
			return this.fetch;
		}
		this.unsupportedFilters.clear();
		this.update({});
		// Asked for, so it is worth showing, unlike a poll.
		return this.startLoad(true);
	}

	public dispose(): void {
		this.disposed = true;
		this.cancelLoad();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.changeEmitter.dispose();
	}

	private startLoad(awaited = false): Promise<void> {
		if (!this.visible && this.fetching) {
			return this.fetch;
		}
		this.fetch = this.load(awaited).catch((error: unknown) => {
			this.logger.error("Unexpected failure while listing workspaces", error);
		});
		return this.fetch;
	}

	/** Fetch the active filter; metadata opens independently of listing. */
	private async load(awaited = false): Promise<void> {
		if (this.disposed || !this.visible) {
			return;
		}
		const session = this.sessionState.current;
		if (session.kind !== "signedIn") {
			this.update({ workspaces: [], loading: false, error: null });
			return;
		}

		this.cancelLoad();
		const source = new vscode.CancellationTokenSource();
		this.fetching = source;
		const { token } = source;
		this.update({ loading: awaited || !this.loaded });
		const { getQuery, poll } = WORKSPACE_FILTERS[this.filter];
		try {
			const { workspaces } = await this.client.getWorkspaces({
				q: getQuery(session),
			});
			if (token.isCancellationRequested) {
				return;
			}
			this.loaded = true;
			this.retries = 0;
			this.update({ workspaces, loading: false, error: null });
			if (poll && !token.isCancellationRequested) {
				this.scheduleLoad();
			}
		} catch (error) {
			if (token.isCancellationRequested) {
				return;
			}
			// The default filter's query is as old as the API; never drop it.
			if (
				this.filter !== DEFAULT_WORKSPACE_FILTER &&
				isAxiosError(error) &&
				error.response?.status === 400
			) {
				// Never leave a filter selected that cannot load.
				this.unsupportedFilters.add(this.filter);
				this.filter = DEFAULT_WORKSPACE_FILTER;
				this.clearList();
				await this.load();
				return;
			}
			this.loaded = true;
			this.logger.warn("Failed to fetch workspaces:", error);
			this.update({
				workspaces: [],
				loading: false,
				error: errToStr(error, "Failed to fetch workspaces"),
			});
			this.retries++;
			this.scheduleLoad();
		} finally {
			if (this.fetching === source) {
				this.fetching = undefined;
				source.dispose();
			}
		}
	}

	/** Record what changed, and push what the webview does not have yet. */
	private update(listed: Listed): void {
		if (this.disposed) {
			return;
		}
		this.workspaces = listed.workspaces ?? this.workspaces;
		this.loading = listed.loading ?? this.loading;
		this.error = listed.error === undefined ? this.error : listed.error;

		const state = this.state;
		const fields = Object.keys(state) as Array<keyof WorkspacesState>;
		const changed = fields.filter(
			(field) => !isDeepStrictEqual(state[field], this.pushed?.[field]),
		);
		this.pushed = state;
		if (changed.length > 0) {
			this.changeEmitter.fire(
				Object.fromEntries(changed.map((field) => [field, state[field]])),
			);
		}
		if (listed.workspaces !== undefined) {
			// Publish the list before opening its metadata sockets.
			void this.watchListedAgents();
		}
	}

	/** Drop the list of the previous filter or session. A fetch follows. */
	private clearList(clearMetadata = false): void {
		this.cancelLoad();
		this.retries = 0;
		this.loaded = false;
		this.workspaces = [];
		this.error = null;
		this.loading =
			this.visible && this.sessionState.current.kind === "signedIn";
		if (clearMetadata) {
			this.agents.clear();
		}
		this.update({ workspaces: [] });
	}

	/** Drop any pending poll and invalidate the fetch in flight. */
	private cancelLoad(): void {
		this.cancelPoll();
		this.fetching?.cancel();
		this.fetching?.dispose();
		this.fetching = undefined;
	}

	/** Queue the next load, backing off while fetches keep failing. */
	private scheduleLoad(): void {
		this.cancelPoll();
		if (this.disposed || !this.visible) {
			return;
		}
		this.nextPoll = setTimeout(
			() => void this.startLoad(),
			Math.min(
				this.poll.intervalMs * 2 ** this.retries,
				this.poll.maxIntervalMs,
			),
		);
	}

	private cancelPoll(): void {
		clearTimeout(this.nextPoll);
		this.nextPoll = undefined;
	}

	/** Watch the agents the webview asked for that are still listed. */
	private watchListedAgents(): Promise<void> {
		const listed = new Set(
			this.visible
				? extractAllAgents(this.workspaces).map((agent) => agent.id)
				: [],
		);
		return this.agents
			.setWatched(this.requestedAgents.filter((agentId) => listed.has(agentId)))
			.catch((error: unknown) => {
				// Metadata is supplementary: never report it as a failure to list.
				this.logger.warn("Failed to watch agent metadata:", error);
			});
	}

	private handleSessionChange(): void {
		this.unsupportedFilters.clear();
		this.requestedAgents = [];
		if (!this.state.capabilities.filters.includes(this.filter)) {
			this.filter = DEFAULT_WORKSPACE_FILTER;
		}
		this.clearList(true);
		void this.startLoad();
	}
}
