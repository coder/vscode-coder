import {
	type Workspace,
	type WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import * as path from "node:path";
import * as vscode from "vscode";

import {
	type AgentMetadataWatcher,
	createAgentMetadataWatcher,
	formatEventLabel,
	formatMetadataError,
} from "../api/agentMetadataHelper";
import {
	type AgentMetadataEvent,
	workspaceStatusLabel,
	extractAgents,
	extractAllAgents,
} from "../api/api-helper";
import { type CoderApi } from "../api/coderApi";
import { type Logger } from "../logging/logger";

import type {
	WorkspaceSessionSnapshot,
	WorkspaceSessionState,
} from "./session";

export enum WorkspaceQuery {
	Mine = "owner:me",
	All = "",
	Shared = "shared:true",
}

/** Per-view rendering behavior, keyed by workspace query. */
interface WorkspaceQueryConfig {
	readonly showOwner: boolean;
	readonly showMetadata: boolean;
	readonly excludeOwn: boolean;
}

const WORKSPACE_QUERY_CONFIG = {
	[WorkspaceQuery.Mine]: {
		showOwner: false,
		showMetadata: true,
		excludeOwn: false,
	},
	[WorkspaceQuery.All]: {
		showOwner: true,
		showMetadata: false,
		excludeOwn: false,
	},
	[WorkspaceQuery.Shared]: {
		showOwner: true,
		showMetadata: false,
		excludeOwn: true,
	},
} as const satisfies Record<WorkspaceQuery, WorkspaceQueryConfig>;

export interface WorkspaceProviderOptions {
	readonly refreshIntervalMs?: number;
}

// Bounds fetch() retries when the session keeps changing mid-request.
export const MAX_FETCH_ATTEMPTS = 3;

/**
 * Polls workspaces using the provided REST client and renders them in a tree.
 *
 * Polling does not start until fetchAndRefresh() is called at least once.
 *
 * If a poll fails or the session is signed out, the tree is cleared and polling
 * stops until the next fetchAndRefresh() or session change.
 */
export class WorkspaceProvider
	implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
	// Undefined if we have never fetched workspaces before.
	private workspaces: WorkspaceTreeItem[] | undefined;
	private readonly agentWatchers = new Map<
		WorkspaceAgent["id"],
		AgentMetadataWatcher
	>();
	private readonly sessionChangeDisposable: vscode.Disposable;
	private readonly config: WorkspaceQueryConfig;
	private timeout: NodeJS.Timeout | undefined;
	private fetching = false;
	private visible = false;
	private disposed = false;

	constructor(
		private readonly getWorkspacesQuery: WorkspaceQuery,
		private readonly client: CoderApi,
		private readonly logger: Logger,
		private readonly sessionState: WorkspaceSessionState,
		private readonly options: WorkspaceProviderOptions = {},
	) {
		this.config = WORKSPACE_QUERY_CONFIG[getWorkspacesQuery];
		this.sessionChangeDisposable = this.sessionState.onDidChange(() => {
			this.clear();
			void this.fetchAndRefresh();
		});
	}

	// Fetch workspaces, render them, and queue the next poll. Does nothing when
	// hidden, disposed, or already fetching. Never rejects, so it is safe as void.
	public async fetchAndRefresh(): Promise<void> {
		if (this.disposed || this.fetching || !this.visible) {
			return;
		}
		this.fetching = true;
		// A manual refresh may race a scheduled one, so drop any pending timer.
		this.cancelPendingRefresh();

		let hadError = false;
		try {
			this.setWorkspaces(await this.fetch());
		} catch (error) {
			this.logger.warn("Failed to fetch workspaces:", error);
			hadError = true;
			this.setWorkspaces([]);
		} finally {
			this.fetching = false;
		}

		if (
			!hadError &&
			!this.disposed &&
			this.visible &&
			this.sessionState.getSnapshot().kind === "signedIn"
		) {
			this.maybeScheduleRefresh();
		}
	}

	private setWorkspaces(workspaces: WorkspaceTreeItem[]): void {
		if (this.disposed) {
			return;
		}
		this.workspaces = workspaces;
		this.refreshTree();
	}

	/**
	 * Fetch workspaces and turn them into tree items. Returns an empty list when
	 * signed out, and throws if the query fails.
	 */
	private async fetch(): Promise<WorkspaceTreeItem[]> {
		for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
			if (this.disposed) {
				return [];
			}
			const session = this.sessionState.getSnapshot();
			if (session.kind !== "signedIn") {
				return [];
			}

			const resp = await this.client.getWorkspaces({
				q: this.getWorkspacesQuery,
			});

			// Session changed mid-request; this result is stale, so retry.
			if (this.sessionChangedSince(session)) {
				continue;
			}

			const workspaces = this.filterWorkspaces(resp.workspaces, session);
			const oldWatcherIds = [...this.agentWatchers.keys()];
			const reusedWatcherIds: string[] = [];

			// TODO: I think it might make more sense for the tree items to contain
			// their own watchers, rather than recreate the tree items every time
			// and have this separate map held outside the tree.
			if (this.config.showMetadata) {
				const agents = extractAllAgents(workspaces);
				for (const agent of agents) {
					// If we have an existing watcher, re-use it.
					const oldWatcher = this.agentWatchers.get(agent.id);
					if (oldWatcher) {
						reusedWatcherIds.push(agent.id);
						continue;
					}
					const watcher = await createAgentMetadataWatcher(
						agent.id,
						this.client,
					);
					// dispose() or a session change may have raced this await;
					// drop the watcher rather than leak it or render stale data.
					if (this.disposed || this.sessionChangedSince(session)) {
						watcher.dispose();
						return [];
					}
					watcher.onChange(() => this.refreshTree());
					this.agentWatchers.set(agent.id, watcher);
				}
			}

			// Dispose of watchers we ended up not reusing.
			for (const id of oldWatcherIds) {
				if (!reusedWatcherIds.includes(id)) {
					this.agentWatchers.get(id)?.dispose();
					this.agentWatchers.delete(id);
				}
			}

			return workspaces.map(
				(workspace: Workspace) =>
					new WorkspaceTreeItem(
						workspace,
						this.config.showOwner,
						this.config.showMetadata,
					),
			);
		}
		// Session changed on every attempt; the next refresh will catch up.
		return [];
	}

	/** True if the session signed out or changed revision since `session`. */
	private sessionChangedSince(
		session: Extract<WorkspaceSessionSnapshot, { kind: "signedIn" }>,
	): boolean {
		const latest = this.sessionState.getSnapshot();
		return latest.kind !== "signedIn" || latest.revision !== session.revision;
	}

	private filterWorkspaces(
		workspaces: readonly Workspace[],
		session: Extract<WorkspaceSessionSnapshot, { kind: "signedIn" }>,
	): readonly Workspace[] {
		if (!this.config.excludeOwn) {
			return workspaces;
		}
		// `shared:true` also returns workspaces we own and shared out; drop them
		// to leave only those shared with us.
		return workspaces.filter(
			(workspace) => workspace.owner_id !== session.userId,
		);
	}

	/**
	 * Either start or stop the refresh timer based on visibility.
	 *
	 * If we have never fetched workspaces and are visible, fetch immediately.
	 */
	public setVisibility(visible: boolean) {
		if (this.disposed) {
			return;
		}
		this.visible = visible;
		if (!visible) {
			this.cancelPendingRefresh();
		} else if (this.workspaces) {
			this.maybeScheduleRefresh();
		} else {
			void this.fetchAndRefresh();
		}
	}

	private cancelPendingRefresh() {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = undefined;
		}
	}

	/** Schedule the next poll, unless one is pending or no interval is set. */
	private maybeScheduleRefresh() {
		if (this.options.refreshIntervalMs && !this.timeout) {
			this.timeout = setTimeout(() => {
				void this.fetchAndRefresh();
			}, this.options.refreshIntervalMs);
		}
	}

	private readonly _onDidChangeTreeData: vscode.EventEmitter<
		vscode.TreeItem | undefined
	> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<
		vscode.TreeItem | undefined | null | void
	> = this._onDidChangeTreeData.event;

	// Re-render the tree from the current workspaces. Does not fetch.
	public refreshTree(item?: vscode.TreeItem): void {
		if (this.disposed) {
			return;
		}
		this._onDidChangeTreeData.fire(item);
	}

	public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	public getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
		if (element) {
			if (element instanceof WorkspaceTreeItem) {
				const agents = extractAgents(element.workspace.latest_build.resources);
				const agentTreeItems = agents.map(
					(agent) =>
						new AgentTreeItem(agent, element.workspace, element.watchMetadata),
				);

				return Promise.resolve(agentTreeItems);
			} else if (element instanceof AgentTreeItem) {
				const watcher = this.agentWatchers.get(element.agent.id);
				if (watcher?.error) {
					return Promise.resolve([new ErrorTreeItem(watcher.error)]);
				}

				const items: vscode.TreeItem[] = [];

				// Add app status section with collapsible header
				if (element.agent.apps && element.agent.apps.length > 0) {
					const appStatuses = [];
					for (const app of element.agent.apps) {
						if (app.statuses && app.statuses.length > 0) {
							for (const status of app.statuses) {
								// Show all statuses, not just ones needing attention.
								// We need to do this for now because the reporting isn't super accurate
								// yet.
								appStatuses.push(
									new AppStatusTreeItem({
										id: status.id,
										name: status.message,
										command: app.command,
										workspace_name: element.workspace.name,
									}),
								);
							}
						}
					}

					// Show the section if it has any items
					if (appStatuses.length > 0) {
						appStatuses.reverse();
						const appStatusSection = new SectionTreeItem(
							"App Statuses",
							appStatuses,
						);
						items.push(appStatusSection);
					}
				}

				const savedMetadata = watcher?.metadata ?? [];

				// Add agent metadata section with collapsible header
				if (savedMetadata.length > 0) {
					const metadataSection = new SectionTreeItem(
						"Agent Metadata",
						savedMetadata.map(
							(metadata) => new AgentMetadataTreeItem(metadata),
						),
					);
					items.push(metadataSection);
				}

				return Promise.resolve(items);
			} else if (element instanceof SectionTreeItem) {
				// Return the children of the section
				return Promise.resolve(element.children);
			}

			return Promise.resolve([]);
		}
		return Promise.resolve(this.workspaces ?? []);
	}

	/**
	 * Clear all workspaces from the tree without fetching.
	 */
	public clear(): void {
		this.clearState();
		this.refreshTree();
	}

	private clearState(): void {
		this.cancelPendingRefresh();
		for (const watcher of this.agentWatchers.values()) {
			watcher.dispose();
		}
		this.agentWatchers.clear();
		this.workspaces = undefined;
	}

	public dispose() {
		this.disposed = true;
		this.clearState();
		this.sessionChangeDisposable.dispose();
		this._onDidChangeTreeData.dispose();
	}
}

/**
 * A tree item that represents a collapsible section with child items
 */
class SectionTreeItem extends vscode.TreeItem {
	constructor(
		label: string,
		public readonly children: vscode.TreeItem[],
	) {
		super(label, vscode.TreeItemCollapsibleState.Collapsed);
		this.contextValue = "coderSectionHeader";
	}
}

class ErrorTreeItem extends vscode.TreeItem {
	constructor(error: unknown) {
		super(formatMetadataError(error), vscode.TreeItemCollapsibleState.None);
		this.contextValue = "coderAgentMetadata";
	}
}

class AgentMetadataTreeItem extends vscode.TreeItem {
	constructor(metadataEvent: AgentMetadataEvent) {
		const label = formatEventLabel(metadataEvent);

		super(label, vscode.TreeItemCollapsibleState.None);
		const collected_at = new Date(
			metadataEvent.result.collected_at,
		).toLocaleString();

		this.id = metadataEvent.description.key;
		this.tooltip = "Collected at " + collected_at;
		this.contextValue = "coderAgentMetadata";
	}
}

class AppStatusTreeItem extends vscode.TreeItem {
	constructor(
		public readonly app: {
			id: string;
			name: string;
			url?: string;
			command?: string;
			workspace_name?: string;
		},
	) {
		super("", vscode.TreeItemCollapsibleState.None);
		this.id = app.id;
		this.description = app.name;
		this.contextValue = "coderAppStatus";

		// Add command to handle clicking on the app
		this.command = {
			command: "coder.openAppStatus",
			title: "Open App Status",
			arguments: [app],
		};
	}
}

type CoderOpenableTreeItemType =
	| "coderWorkspaceSingleAgent"
	| "coderWorkspaceMultipleAgents"
	| "coderAgent";

export class OpenableTreeItem extends vscode.TreeItem {
	constructor(
		id: string,
		label: string,
		tooltip: string,
		description: string,
		collapsibleState: vscode.TreeItemCollapsibleState,

		public readonly workspace: Workspace,

		baseContextValue: CoderOpenableTreeItemType,
	) {
		super(label, collapsibleState);
		this.id = id;
		this.tooltip = tooltip;
		this.description = description;

		const tags: string[] = [baseContextValue];
		if (workspace.latest_build.status === "running") {
			tags.push("running");
		}
		this.contextValue = tags.join("+");
	}

	override iconPath = {
		light: vscode.Uri.file(
			path.join(__filename, "..", "..", "media", "logo-black.svg"),
		),
		dark: vscode.Uri.file(
			path.join(__filename, "..", "..", "media", "logo-white.svg"),
		),
	};
}

export class AgentTreeItem extends OpenableTreeItem {
	constructor(
		public readonly agent: WorkspaceAgent,
		workspace: Workspace,
		watchMetadata = false,
	) {
		super(
			agent.id, // id
			agent.name, // label
			`Status: ${agent.status}`, // tooltip
			agent.status, // description
			watchMetadata // collapsed
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None,
			workspace,
			"coderAgent",
		);
	}
}

export class WorkspaceTreeItem extends OpenableTreeItem {
	constructor(
		workspace: Workspace,
		public readonly showOwner: boolean,
		public readonly watchMetadata = false,
	) {
		const status = workspaceStatusLabel(workspace.latest_build.status);

		const label = showOwner
			? `${workspace.owner_name} / ${workspace.name}`
			: workspace.name;
		const detail = `Template: ${workspace.template_display_name || workspace.template_name} • Status: ${status}`;
		const agents = extractAgents(workspace.latest_build.resources);
		super(
			workspace.id,
			label,
			detail,
			workspace.latest_build.status, // description
			showOwner // collapsed
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.Expanded,
			workspace,
			agents.length > 1
				? "coderWorkspaceMultipleAgents"
				: "coderWorkspaceSingleAgent",
		);
	}
}
