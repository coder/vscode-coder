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

export interface WorkspaceProviderOptions {
	readonly refreshIntervalMs?: number;
}

/**
 * Polls workspaces using the provided REST client and renders them in a tree.
 *
 * Polling does not start until fetchAndRefresh() is called at least once.
 *
 * If the poll fails or the client has no URL configured, clear the tree and
 * abort polling until fetchAndRefresh() is called again.
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
	private timeout: NodeJS.Timeout | undefined;
	private fetching = false;
	private refreshQueued = false;
	private visible = false;
	private disposed = false;

	constructor(
		private readonly getWorkspacesQuery: WorkspaceQuery,
		private readonly client: CoderApi,
		private readonly logger: Logger,
		private readonly sessionState: WorkspaceSessionState,
		private readonly options: WorkspaceProviderOptions = {},
	) {
		this.sessionChangeDisposable = this.sessionState.onDidChange(() => {
			this.clear();
			this.requestRefresh();
			void this.runRefreshLoop();
		});
	}

	// fetchAndRefresh fetches new workspaces, re-renders the entire tree, then
	// keeps refreshing (if a timer length was provided) as long as the user is
	// still logged in and no errors were encountered fetching workspaces.
	// Calling this while not visible is a no-op and will return immediately.
	public async fetchAndRefresh() {
		this.requestRefresh();
		await this.runRefreshLoop();
	}

	private requestRefresh(): void {
		if (this.disposed || !this.visible) {
			return;
		}
		this.refreshQueued = true;
	}

	private async runRefreshLoop(): Promise<void> {
		if (this.disposed || this.fetching || !this.visible) {
			return;
		}

		this.fetching = true;
		this.cancelPendingRefresh();
		let shouldScheduleRefresh = false;

		try {
			while (this.refreshQueued && !this.disposed && this.visible) {
				this.refreshQueued = false;
				shouldScheduleRefresh = false;
				const session = this.sessionState.getSnapshot();

				if (session.kind !== "signedIn") {
					this.setWorkspaces([]);
					continue;
				}

				let hadError = false;
				try {
					const workspaces = await this.fetch(session);
					if (workspaces && !this.disposed) {
						this.setWorkspaces(workspaces);
					}
				} catch (error) {
					this.logger.warn("Failed to fetch workspaces:", error);
					hadError = true;
					this.setWorkspaces([]);
				}

				shouldScheduleRefresh = !hadError && !this.refreshQueued;
			}
		} finally {
			this.fetching = false;
			if (this.refreshQueued && !this.disposed && this.visible) {
				void this.runRefreshLoop();
			} else if (shouldScheduleRefresh && !this.disposed && this.visible) {
				this.maybeScheduleRefresh();
			}
		}
	}

	private setWorkspaces(workspaces: WorkspaceTreeItem[]): void {
		this.workspaces = workspaces;
		this.refresh();
	}

	/**
	 * Fetch workspaces and turn them into tree items.  Throw an error if not
	 * logged in or the query fails.
	 */
	private async fetch(
		session: Extract<WorkspaceSessionSnapshot, { kind: "signedIn" }>,
	): Promise<WorkspaceTreeItem[] | undefined> {
		// If there is no URL configured, assume we are logged out.
		const url = this.client.getAxiosInstance().defaults.baseURL;
		if (!url) {
			throw new Error("not logged in");
		}

		const resp = await this.client.getWorkspaces({
			q: this.getWorkspacesQuery,
		});

		const latestSession = this.sessionState.getSnapshot();
		const url2 = this.client.getAxiosInstance().defaults.baseURL;
		if (!url2) {
			throw new Error("not logged in");
		}
		if (
			url !== url2 ||
			latestSession.kind !== "signedIn" ||
			latestSession.revision !== session.revision
		) {
			this.refreshQueued = true;
			return undefined;
		}

		const workspaces = this.filterWorkspaces(resp.workspaces, session);
		const oldWatcherIds = [...this.agentWatchers.keys()];
		const reusedWatcherIds: string[] = [];

		// TODO: I think it might make more sense for the tree items to contain
		// their own watchers, rather than recreate the tree items every time and
		// have this separate map held outside the tree.
		const showMetadata = this.getWorkspacesQuery === WorkspaceQuery.Mine;
		if (showMetadata) {
			const agents = extractAllAgents(workspaces);
			for (const agent of agents) {
				// If we have an existing watcher, re-use it.
				const oldWatcher = this.agentWatchers.get(agent.id);
				if (oldWatcher) {
					reusedWatcherIds.push(agent.id);
				} else {
					// Otherwise create a new watcher.
					const watcher = await createAgentMetadataWatcher(
						agent.id,
						this.client,
					);
					watcher.onChange(() => this.refresh());
					this.agentWatchers.set(agent.id, watcher);
				}
			}
		}

		// Dispose of watchers we ended up not reusing.
		for (const id of oldWatcherIds) {
			if (!reusedWatcherIds.includes(id)) {
				this.agentWatchers.get(id)?.dispose();
				this.agentWatchers.delete(id);
			}
		}

		const showOwner = this.getWorkspacesQuery !== WorkspaceQuery.Mine;

		// Create tree items for each workspace
		return workspaces.map(
			(workspace: Workspace) =>
				new WorkspaceTreeItem(workspace, showOwner, showMetadata),
		);
	}

	private filterWorkspaces(
		workspaces: readonly Workspace[],
		session: Extract<WorkspaceSessionSnapshot, { kind: "signedIn" }>,
	): readonly Workspace[] {
		if (this.getWorkspacesQuery !== WorkspaceQuery.Shared) {
			return workspaces;
		}
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
		} else if (this.refreshQueued) {
			void this.runRefreshLoop();
		} else if (this.workspaces) {
			this.maybeScheduleRefresh();
		} else {
			this.requestRefresh();
			void this.runRefreshLoop();
		}
	}

	private cancelPendingRefresh() {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = undefined;
		}
	}

	/**
	 * Schedule a refresh if one is not already scheduled or underway and a
	 * timeout length was provided.
	 */
	private maybeScheduleRefresh() {
		if (this.options.refreshIntervalMs && !this.timeout) {
			this.timeout = setTimeout(() => {
				this.requestRefresh();
				void this.runRefreshLoop();
			}, this.options.refreshIntervalMs);
		}
	}

	private readonly _onDidChangeTreeData: vscode.EventEmitter<
		vscode.TreeItem | undefined
	> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<
		vscode.TreeItem | undefined | null | void
	> = this._onDidChangeTreeData.event;

	// refresh causes the tree to re-render. It does not fetch fresh workspaces.
	public refresh(item?: vscode.TreeItem): void {
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
		this.refresh();
	}

	private clearState(): void {
		this.cancelPendingRefresh();
		for (const watcher of this.agentWatchers.values()) {
			watcher.dispose();
		}
		this.agentWatchers.clear();
		this.workspaces = undefined;
		this.refreshQueued = false;
	}

	public dispose() {
		this.disposed = true;
		this.clearState();
		this.sessionChangeDisposable.dispose();
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
