import { Api } from "coder/site/src/api/api";
import {
	Workspace,
	WorkspaceAgent,
	WorkspaceApp,
} from "coder/site/src/api/typesGenerated";
import { EventSource } from "eventsource";
import * as path from "path";
import * as vscode from "vscode";
import { createStreamingFetchAdapter } from "./api";
import {
	AgentMetadataEvent,
	AgentMetadataEventSchemaArray,
	extractAllAgents,
	extractAgents,
	errToStr,
} from "./api-helper";
import { Storage } from "./storage";

export enum WorkspaceQuery {
	Mine = "owner:me",
	All = "",
}

type AgentWatcher = {
	onChange: vscode.EventEmitter<null>["event"];
	dispose: () => void;
	metadata?: AgentMetadataEvent[];
	error?: unknown;
};

/**
 * Polls workspaces using the provided REST client and renders them in a tree.
 *
 * Polling does not start until fetchAndRefresh() is called at least once.
 *
 * If the poll fails or the client has no URL configured, clear the tree and
 * abort polling until fetchAndRefresh() is called again.
 */
export class WorkspaceProvider
	implements vscode.TreeDataProvider<vscode.TreeItem>
{
	// Undefined if we have never fetched workspaces before.
	private workspaces: WorkspaceTreeItem[] | undefined;
	private agentWatchers: Record<WorkspaceAgent["id"], AgentWatcher> = {};
	private timeout: NodeJS.Timeout | undefined;
	private fetching = false;
	private visible = false;

	private _onDidChangeTreeData: vscode.EventEmitter<
		vscode.TreeItem | undefined | null | void
	>;
	readonly onDidChangeTreeData: vscode.Event<
		vscode.TreeItem | undefined | null | void
	>;

	constructor(
		private readonly getWorkspacesQuery: WorkspaceQuery,
		private readonly restClient: Api,
		private readonly storage: Storage,
		private readonly timerSeconds?: number,
	) {
		this._onDidChangeTreeData = this.createEventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
	}

	/**
	 * Create event emitter for tree data changes.
	 * Extracted for testability.
	 */
	protected createEventEmitter(): vscode.EventEmitter<vscode.TreeItem | undefined | null | void> {
		return new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
	}

	// fetchAndRefresh fetches new workspaces, re-renders the entire tree, then
	// keeps refreshing (if a timer length was provided) as long as the user is
	// still logged in and no errors were encountered fetching workspaces.
	// Calling this while already refreshing or not visible is a no-op and will
	// return immediately.
	async fetchAndRefresh() {
		if (this.fetching || !this.visible) {
			return;
		}
		this.fetching = true;

		// It is possible we called fetchAndRefresh() manually (through the button
		// for example), in which case we might still have a pending refresh that
		// needs to be cleared.
		this.cancelPendingRefresh();

		let hadError = false;
		try {
			this.workspaces = await this.fetch();
		} catch (error) {
			hadError = true;
			this.workspaces = [];
		}

		this.fetching = false;

		this.refresh();

		// As long as there was no error we can schedule the next refresh.
		if (!hadError) {
			this.maybeScheduleRefresh();
		}
	}

	/**
	 * Fetch workspaces and turn them into tree items.  Throw an error if not
	 * logged in or the query fails.
	 */
	private async fetch(): Promise<WorkspaceTreeItem[]> {
		if (vscode.env.logLevel <= vscode.LogLevel.Debug) {
			this.storage.writeToCoderOutputChannel(
				`Fetching workspaces: ${this.getWorkspacesQuery || "no filter"}...`,
			);
		}

		// If there is no URL configured, assume we are logged out.
		const restClient = this.restClient;
		const url = restClient.getAxiosInstance().defaults.baseURL;
		if (!url) {
			throw new Error("not logged in");
		}

		const resp = await restClient.getWorkspaces({ q: this.getWorkspacesQuery });

		// We could have logged out while waiting for the query, or logged into a
		// different deployment.
		const url2 = restClient.getAxiosInstance().defaults.baseURL;
		if (!url2) {
			throw new Error("not logged in");
		} else if (url !== url2) {
			// In this case we need to fetch from the new deployment instead.
			// TODO: It would be better to cancel this fetch when that happens,
			// because this means we have to wait for the old fetch to finish before
			// finally getting workspaces for the new one.
			return this.fetch();
		}

		// Manage agent watchers for metadata monitoring
		this.updateAgentWatchers(resp.workspaces, restClient);

		// Create tree items for each workspace
		const workspaceTreeItems = await Promise.all(
			resp.workspaces.map((workspace) => this.createWorkspaceTreeItem(workspace)),
		);

		return workspaceTreeItems;
	}

	/**
	 * Either start or stop the refresh timer based on visibility.
	 *
	 * If we have never fetched workspaces and are visible, fetch immediately.
	 */
	setVisibility(visible: boolean) {
		this.visible = visible;
		this.handleVisibilityChange(visible);
	}

	/**
	 * Handle visibility changes.
	 * Extracted for testability.
	 */
	protected handleVisibilityChange(visible: boolean) {
		if (!visible) {
			this.cancelPendingRefresh();
		} else if (!this.workspaces) {
			this.fetchAndRefresh();
		} else {
			this.maybeScheduleRefresh();
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
		if (this.timerSeconds && !this.timeout && !this.fetching) {
			this.timeout = setTimeout(() => {
				this.fetchAndRefresh();
			}, this.timerSeconds * 1000);
		}
	}


	// refresh causes the tree to re-render.  It does not fetch fresh workspaces.
	refresh(item: vscode.TreeItem | undefined | null | void): void {
		this._onDidChangeTreeData.fire(item);
	}

	async getTreeItem(element: vscode.TreeItem): Promise<vscode.TreeItem> {
		return element;
	}

	getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
		if (element) {
			if (element instanceof WorkspaceTreeItem) {
				return this.getWorkspaceChildren(element);
			} else if (element instanceof AgentTreeItem) {
				return this.getAgentChildren(element);
			} else if (element instanceof SectionTreeItem) {
				// Return the children of the section
				return Promise.resolve(element.children);
			}

			return Promise.resolve([]);
		}
		return Promise.resolve(this.workspaces || []);
	}

	/**
	 * Update agent watchers for metadata monitoring.
	 * Extracted for testability.
	 */
	protected updateAgentWatchers(workspaces: Workspace[], restClient: Api): void {
		const oldWatcherIds = Object.keys(this.agentWatchers);
		const reusedWatcherIds: string[] = [];

		// TODO: I think it might make more sense for the tree items to contain
		// their own watchers, rather than recreate the tree items every time and
		// have this separate map held outside the tree.
		const showMetadata = this.getWorkspacesQuery === WorkspaceQuery.Mine;
		if (showMetadata) {
			const agents = extractAllAgents(workspaces);
			agents.forEach((agent) => {
				// If we have an existing watcher, re-use it.
				if (this.agentWatchers[agent.id]) {
					reusedWatcherIds.push(agent.id);
					return this.agentWatchers[agent.id];
				}
				// Otherwise create a new watcher.
				const watcher = this.createAgentWatcher(agent.id, restClient);
				this.agentWatchers[agent.id] = watcher;
				return watcher;
			});
		}

		// Dispose of watchers we ended up not reusing.
		oldWatcherIds.forEach((id) => {
			if (!reusedWatcherIds.includes(id)) {
				this.agentWatchers[id].dispose();
				delete this.agentWatchers[id];
			}
		});
	}

	/**
	 * Create agent watcher for metadata monitoring.
	 * Extracted for testability.
	 */
	protected createAgentWatcher(agentId: string, restClient: Api): AgentWatcher {
		const watcher = monitorMetadata(agentId, restClient);
		watcher.onChange(() => this.refresh());
		return watcher;
	}

	/**
	 * Create workspace tree item with app status.
	 * Extracted for testability.
	 */
	protected createWorkspaceTreeItem(workspace: Workspace): WorkspaceTreeItem {
		const showMetadata = this.getWorkspacesQuery === WorkspaceQuery.Mine;
		const workspaceTreeItem = new WorkspaceTreeItem(
			workspace,
			this.getWorkspacesQuery === WorkspaceQuery.All,
			showMetadata,
		);

		// Get app status from the workspace agents
		const agents = extractAgents(workspace);
		agents.forEach((agent) => {
			// Check if agent has apps property with status reporting
			if (agent.apps && Array.isArray(agent.apps)) {
				workspaceTreeItem.appStatus = agent.apps.map(
					(app: WorkspaceApp) => ({
						name: app.display_name,
						url: app.url,
						agent_id: agent.id,
						agent_name: agent.name,
						command: app.command,
						workspace_name: workspace.name,
					}),
				);
			}
		});

		return workspaceTreeItem;
	}

	/**
	 * Get children for workspace tree item.
	 * Extracted for testability.
	 */
	protected getWorkspaceChildren(element: WorkspaceTreeItem): Promise<vscode.TreeItem[]> {
		const agents = extractAgents(element.workspace);
		const agentTreeItems = agents.map(
			(agent) =>
				new AgentTreeItem(
					agent,
					element.workspaceOwner,
					element.workspaceName,
					element.watchMetadata,
				),
		);

		return Promise.resolve(agentTreeItems);
	}

	/**
	 * Get children for agent tree item.
	 * Extracted for testability.
	 */
	protected getAgentChildren(element: AgentTreeItem): Promise<vscode.TreeItem[]> {
		const watcher = this.agentWatchers[element.agent.id];
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
								name: status.message,
								command: app.command,
								workspace_name: element.workspaceName,
							}),
						);
					}
				}
			}

			// Show the section if it has any items
			if (appStatuses.length > 0) {
				const appStatusSection = new SectionTreeItem(
					"App Statuses",
					appStatuses.reverse(),
				);
				items.push(appStatusSection);
			}
		}

		const savedMetadata = watcher?.metadata || [];

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
	}
}

// monitorMetadata opens an SSE endpoint to monitor metadata on the specified
// agent and registers a watcher that can be disposed to stop the watch and
// emits an event when the metadata changes.
function monitorMetadata(
	agentId: WorkspaceAgent["id"],
	restClient: Api,
): AgentWatcher {
	// TODO: Is there a better way to grab the url and token?
	const url = restClient.getAxiosInstance().defaults.baseURL;
	const metadataUrl = new URL(
		`${url}/api/v2/workspaceagents/${agentId}/watch-metadata`,
	);
	const eventSource = new EventSource(metadataUrl.toString(), {
		fetch: createStreamingFetchAdapter(restClient.getAxiosInstance()),
	});

	let disposed = false;
	const onChange = new vscode.EventEmitter<null>();
	const watcher: AgentWatcher = {
		onChange: onChange.event,
		dispose: () => {
			if (!disposed) {
				eventSource.close();
				disposed = true;
			}
		},
	};

	eventSource.addEventListener("data", (event) => {
		try {
			const dataEvent = JSON.parse(event.data);
			const metadata = AgentMetadataEventSchemaArray.parse(dataEvent);

			// Overwrite metadata if it changed.
			if (JSON.stringify(watcher.metadata) !== JSON.stringify(metadata)) {
				watcher.metadata = metadata;
				onChange.fire(null);
			}
		} catch (error) {
			watcher.error = error;
			onChange.fire(null);
		}
	});

	return watcher;
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
		super(
			"Failed to query metadata: " + errToStr(error, "no error provided"),
			vscode.TreeItemCollapsibleState.None,
		);
		this.contextValue = "coderAgentMetadata";
	}
}

class AgentMetadataTreeItem extends vscode.TreeItem {
	constructor(metadataEvent: AgentMetadataEvent) {
		const label =
			metadataEvent.description.display_name.trim() +
			": " +
			metadataEvent.result.value.replace(/\n/g, "").trim();

		super(label, vscode.TreeItemCollapsibleState.None);
		const collected_at = new Date(
			metadataEvent.result.collected_at,
		).toLocaleString();

		this.tooltip = "Collected at " + collected_at;
		this.contextValue = "coderAgentMetadata";
	}
}

class AppStatusTreeItem extends vscode.TreeItem {
	constructor(
		public readonly app: {
			name: string;
			url?: string;
			command?: string;
			workspace_name?: string;
		},
	) {
		super("", vscode.TreeItemCollapsibleState.None);
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
		label: string,
		tooltip: string,
		description: string,
		collapsibleState: vscode.TreeItemCollapsibleState,

		public readonly workspaceOwner: string,
		public readonly workspaceName: string,
		public readonly workspaceAgent: string | undefined,
		public readonly workspaceFolderPath: string | undefined,

		contextValue: CoderOpenableTreeItemType,
	) {
		super(label, collapsibleState);
		this.contextValue = contextValue;
		this.tooltip = tooltip;
		this.description = description;
	}

	iconPath = {
		light: path.join(__filename, "..", "..", "media", "logo.svg"),
		dark: path.join(__filename, "..", "..", "media", "logo.svg"),
	};
}

class AgentTreeItem extends OpenableTreeItem {
	constructor(
		public readonly agent: WorkspaceAgent,
		workspaceOwner: string,
		workspaceName: string,
		watchMetadata = false,
	) {
		super(
			agent.name, // label
			`Status: ${agent.status}`, // tooltip
			agent.status, // description
			watchMetadata
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None,
			workspaceOwner,
			workspaceName,
			agent.name,
			agent.expanded_directory,
			"coderAgent",
		);
	}
}

export class WorkspaceTreeItem extends OpenableTreeItem {
	public appStatus: {
		name: string;
		url?: string;
		agent_id?: string;
		agent_name?: string;
		command?: string;
		workspace_name?: string;
	}[] = [];

	constructor(
		public readonly workspace: Workspace,
		public readonly showOwner: boolean,
		public readonly watchMetadata = false,
	) {
		const status =
			workspace.latest_build.status.substring(0, 1).toUpperCase() +
			workspace.latest_build.status.substring(1);

		const label = showOwner
			? `${workspace.owner_name} / ${workspace.name}`
			: workspace.name;
		const detail = `Template: ${workspace.template_display_name || workspace.template_name} • Status: ${status}`;
		const agents = extractAgents(workspace);
		super(
			label,
			detail,
			workspace.latest_build.status, // description
			showOwner
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.Expanded,
			workspace.owner_name,
			workspace.name,
			undefined,
			agents[0]?.expanded_directory,
			agents.length > 1
				? "coderWorkspaceMultipleAgents"
				: "coderWorkspaceSingleAgent",
		);
	}
}
