import { isAxiosError } from "axios";
import { isDeepStrictEqual } from "node:util";
import * as vscode from "vscode";

import {
	isWorkspaceBusy,
	type Workspace,
	type WorkspaceAction,
	type WorkspaceFilter,
	type WorkspaceListStatus,
	type WorkspacesState,
} from "@repo/shared";

import { HttpStatusCode } from "../../api/httpStatusCode";
import { extractAllAgents } from "../../api/models";
import { errToStr } from "../../error/normalize";
import { AgentMetadataTracker } from "../../workspace/agentMetadataTracker";
import {
	availableFilters,
	DEFAULT_WORKSPACE_FILTER,
	isQueryRejected,
	WORKSPACE_FILTERS,
} from "../../workspace/filters";

import { Poller, type NextRun, type RetryOptions } from "./poller";

import type { AgentMetadataClient } from "../../api/agentMetadata";
import type { CoderApi } from "../../api/coderApi";
import type { SessionState } from "../../deployment/sessionStore";
import type { Logger } from "../../logging/logger";

interface WorkspacesClient extends AgentMetadataClient {
	readonly experimental: Pick<CoderApi["experimental"], "getChatsByWorkspace">;
	getWorkspace(workspaceId: string): Promise<Workspace>;
	getWorkspaces(
		request: Parameters<CoderApi["getWorkspaces"]>[0],
	): Promise<{ readonly workspaces: readonly Workspace[] }>;
}

const RETRY: RetryOptions = { initialDelayMs: 5_000, maxDelayMs: 60_000 };
const LOADING: WorkspaceListStatus = { kind: "loading" };
const READY: WorkspaceListStatus = { kind: "ready" };
const MINUTE_MS = 60_000;
const FOLLOW_INTERVAL_MS = 5_000;

function listedAgentIds(
	requested: readonly string[],
	workspaces: readonly Workspace[],
): readonly string[] {
	if (requested.length === 0) {
		return [];
	}
	const listed = new Set(extractAllAgents(workspaces).map((agent) => agent.id));
	return requested.filter((agentId) => listed.has(agentId));
}

/**
 * Owns the state the Workspaces panel renders: lists the active filter while
 * visible, watches the agents the panel is showing, and reports every change.
 */
export class WorkspaceStore implements vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<WorkspacesState>();
	private readonly agents: AgentMetadataTracker;
	private readonly poller: Poller;
	private readonly disposables: readonly vscode.Disposable[];
	/** Filters this deployment rejected, so they are no longer offered. */
	private readonly unsupportedFilters = new Set<WorkspaceFilter>();

	public readonly onDidChange = this.changeEmitter.event;

	private filter: WorkspaceFilter = DEFAULT_WORKSPACE_FILTER;
	private workspaces: readonly Workspace[] = [];
	private listedAt: number | undefined;
	private agentWorkspaceIds: readonly string[] = [];
	private agentLookupSupported = true;
	private status = LOADING;
	/** Agents the webview is showing, listed or not. */
	private requestedAgents: readonly string[] = [];
	private lastEmitted: WorkspacesState | undefined;
	/** Re-read workspaces acted on, since their filter may not poll. */
	private readonly followers = new Map<string, Poller>();
	/** Actions running, which may not have queued their build yet. */
	private readonly acting = new Map<string, WorkspaceAction>();
	private visible = false;
	private disposed = false;

	constructor(
		private readonly client: WorkspacesClient,
		private readonly logger: Logger,
		private readonly sessionState: SessionState,
	) {
		this.agents = new AgentMetadataTracker(client);
		this.poller = new Poller((token) => this.list(token), RETRY, logger);
		this.disposables = [
			this.poller,
			this.agents,
			this.agents.onDidChange(() => this.publish()),
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
			filter: this.filter,
			workspaces: this.workspaces,
			status: this.status,
			metadata: this.agents.metadata,
			...(this.listedAt === undefined ? {} : { listedAt: this.listedAt }),
			...(this.agentWorkspaceIds.length
				? { agentWorkspaceIds: this.agentWorkspaceIds }
				: {}),
			...(this.acting.size
				? { pendingActions: Object.fromEntries(this.acting) }
				: {}),
		};
	}

	/** The list in flight, or the last one. Never rejects. */
	public get settled(): Promise<void> {
		return this.poller.settled;
	}

	public findWorkspace(workspaceId: string): Workspace | undefined {
		return this.workspaces.find((workspace) => workspace.id === workspaceId);
	}

	/** A hidden store keeps its list and sockets; a revealed one lists again. */
	public setVisible(visible: boolean): Promise<void> {
		if (this.disposed || this.visible === visible) {
			return this.settled;
		}
		this.visible = visible;
		return visible ? this.poller.run() : this.settled;
	}

	public setFilter(filter: WorkspaceFilter): Promise<void> {
		if (this.disposed || filter === this.filter) {
			return this.settled;
		}
		if (!this.filters.includes(filter)) {
			this.logger.warn(`Ignoring unavailable workspaces filter: ${filter}`);
			return this.settled;
		}
		this.filter = filter;
		this.listedAt = undefined;
		this.agentLookupSupported = true;
		return this.reload();
	}

	/** Watch exactly these agents, as far as the list has them. */
	public watchAgents(agentIds: readonly string[]): Promise<void> {
		this.requestedAgents = agentIds;
		return this.watchListedAgents();
	}

	/**
	 * Report `action` as pending while `run` performs it, and keep the row
	 * current until its build settles. Ignored while another action runs there.
	 */
	public async followAction(
		workspaceId: string,
		action: WorkspaceAction,
		run: () => Promise<void>,
	): Promise<void> {
		if (this.disposed) {
			return;
		}
		const session = this.sessionState.current;
		const pending = this.acting.get(workspaceId);
		if (pending) {
			this.logger.warn(
				`Ignoring ${action} on workspace ${workspaceId} while ${pending} runs`,
			);
			return;
		}
		this.acting.set(workspaceId, action);
		this.publish();
		void this.follow(workspaceId);
		try {
			await run();
		} finally {
			if (!this.disposed && this.sessionState.current === session) {
				// Re-read first, so the old actions never reappear.
				await this.follow(workspaceId);
				if (!this.disposed && this.sessionState.current === session) {
					this.acting.delete(workspaceId);
					this.publish();
				}
			}
		}
	}

	/** List now, keeping the list on show and offering rejected filters again. */
	public refresh(): Promise<void> {
		// A hidden panel cannot re-validate a filter it offers again.
		if (this.disposed || !this.visible) {
			return this.settled;
		}
		this.unsupportedFilters.clear();
		this.agentLookupSupported = true;
		return this.reload(this.workspaces);
	}

	public dispose(): void {
		this.disposed = true;
		this.acting.clear();
		this.stopFollowing();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.changeEmitter.dispose();
	}

	private get filters(): readonly WorkspaceFilter[] {
		return availableFilters(this.sessionState.current, this.unsupportedFilters);
	}

	private async list(token: vscode.CancellationToken): Promise<NextRun> {
		if (this.disposed) {
			return "idle";
		}
		const session = this.sessionState.current;
		if (session.kind !== "signedIn") {
			this.setList([]);
			return "idle";
		}
		if (!this.visible) {
			return "idle";
		}
		const { getQuery, pollIntervalMs } = WORKSPACE_FILTERS[this.filter];
		try {
			const { workspaces } = await this.client.getWorkspaces({
				q: getQuery(session),
			});
			// Cancelled by a filter switch, a refresh, a session change, or disposal.
			if (token.isCancellationRequested) {
				return "idle";
			}
			// Polls that change nothing then publish at most once a minute.
			this.listedAt = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
			this.setList(workspaces);
			await this.loadAgentWorkspaces(workspaces, token);
			return this.visible && pollIntervalMs !== undefined
				? { delayMs: pollIntervalMs }
				: "idle";
		} catch (error) {
			if (token.isCancellationRequested) {
				return "idle";
			}
			// The default filter's query is as old as the API; never drop it.
			if (this.filter !== DEFAULT_WORKSPACE_FILTER && isQueryRejected(error)) {
				this.unsupportedFilters.add(this.filter);
				this.filter = DEFAULT_WORKSPACE_FILTER;
				this.listedAt = undefined;
				this.setList([], LOADING);
				return this.list(token);
			}
			this.logger.warn("Failed to fetch workspaces:", error);
			this.setList(this.workspaces, {
				kind: "failed",
				error: errToStr(error, "Failed to fetch workspaces"),
			});
			return "retry";
		}
	}

	private async loadAgentWorkspaces(
		workspaces: readonly Workspace[],
		token: vscode.CancellationToken,
	): Promise<void> {
		if (
			!this.agentLookupSupported ||
			!this.visible ||
			token.isCancellationRequested ||
			workspaces.length === 0
		) {
			return;
		}
		try {
			const chats = await this.client.experimental.getChatsByWorkspace(
				workspaces.map((workspace) => workspace.id),
			);
			if (this.disposed || token.isCancellationRequested) {
				return;
			}
			this.agentWorkspaceIds = workspaces
				.filter((workspace) => Boolean(chats[workspace.id]))
				.map((workspace) => workspace.id);
			this.publish();
		} catch (error) {
			if (this.disposed || token.isCancellationRequested) {
				return;
			}
			const status = isAxiosError(error) ? error.response?.status : undefined;
			if (
				status === HttpStatusCode.FORBIDDEN ||
				status === HttpStatusCode.NOT_FOUND
			) {
				this.agentLookupSupported = false;
				this.agentWorkspaceIds = [];
				this.publish();
			} else {
				this.logger.warn("Failed to look up Agent workspaces:", error);
			}
		}
	}

	private follow(workspaceId: string): Promise<void> {
		let follower = this.followers.get(workspaceId);
		if (!follower) {
			follower = new Poller(
				(token) => this.refreshWorkspace(workspaceId, token),
				RETRY,
				this.logger,
			);
			this.followers.set(workspaceId, follower);
		}
		return follower.run();
	}

	private async refreshWorkspace(
		workspaceId: string,
		token: vscode.CancellationToken,
	): Promise<NextRun> {
		let workspace: Workspace;
		try {
			workspace = await this.client.getWorkspace(workspaceId);
		} catch (error) {
			if (this.disposed || token.isCancellationRequested) {
				return "idle";
			}
			// A deleted workspace is gone, so list again to drop it.
			this.logger.warn("Failed to refresh workspace:", error);
			void this.poller.run();
			return "idle";
		}
		if (this.disposed || token.isCancellationRequested) {
			return "idle";
		}
		if (this.findWorkspace(workspaceId)) {
			this.setList(
				this.workspaces.map((listed) =>
					listed.id === workspaceId ? workspace : listed,
				),
				this.status,
			);
		}
		return this.acting.has(workspaceId) || isWorkspaceBusy(workspace)
			? { delayMs: FOLLOW_INTERVAL_MS }
			: "idle";
	}

	private stopFollowing(): void {
		for (const follower of this.followers.values()) {
			follower.dispose();
		}
		this.followers.clear();
	}

	/** Show `workspaces` as loading, then list again. */
	private reload(workspaces: readonly Workspace[] = []): Promise<void> {
		this.setList(workspaces, LOADING);
		return this.poller.run();
	}

	private setList(workspaces: readonly Workspace[], status = READY): void {
		this.workspaces = workspaces;
		this.agentWorkspaceIds = this.agentWorkspaceIds.filter((id) =>
			workspaces.some((workspace) => workspace.id === id),
		);
		this.status = status;
		void this.watchListedAgents();
		this.publish();
	}

	private watchListedAgents(): Promise<void> {
		return this.agents
			.watch(listedAgentIds(this.requestedAgents, this.workspaces))
			.catch((error: unknown) => {
				// Metadata is supplementary: never report it as a failure to list.
				this.logger.warn("Failed to watch agent metadata:", error);
			});
	}

	private publish(): void {
		if (this.disposed) {
			return;
		}
		const state = this.state;
		if (!isDeepStrictEqual(state, this.lastEmitted)) {
			this.lastEmitted = state;
			this.changeEmitter.fire(state);
		}
	}

	private handleSessionChange(): void {
		this.unsupportedFilters.clear();
		this.listedAt = undefined;
		this.agentLookupSupported = true;
		this.agentWorkspaceIds = [];
		this.requestedAgents = [];
		this.acting.clear();
		this.stopFollowing();
		if (!this.filters.includes(this.filter)) {
			this.filter = DEFAULT_WORKSPACE_FILTER;
		}
		void this.reload();
		// Another session's sockets must not linger.
		this.agents.clear();
	}
}
