import { Api } from "coder/site/src/api/api";
import {
	Workspace,
	WorkspaceAgent,
	WorkspaceApp,
} from "coder/site/src/api/typesGenerated";
import * as path from "path";
import * as vscode from "vscode";
import {
	AgentMetadataWatcher,
	createAgentMetadataWatcher,
	formatEventLabel,
	formatMetadataError,
} from "./agentMetadataHelper";
import {
	AgentMetadataEvent,
	extractAllAgents,
	extractAgents,
} from "./api-helper";
import { Storage } from "./storage";

export enum WorkspaceQuery {
	Mine = "owner:me",
	All = "",
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
	implements vscode.TreeDataProvider<vscode.TreeItem>
{
	// Undefined if we have never fetched workspaces before.
	private workspaces: WorkspaceTreeItem[] | undefined;
	private agentWatchers: Record<WorkspaceAgent["id"], AgentMetadataWatcher> =
		{};
	private timeout: NodeJS.Timeout | undefined;
	private fetching = false;
	private visible = false;
	private searchFilter = "";
	private metadataCache: Record<string, string> = {};
	private searchDebounceTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly getWorkspacesQuery: WorkspaceQuery,
		private readonly restClient: Api,
		private readonly storage: Storage,
		private readonly timerSeconds?: number,
	) {
		// No initialization.
	}

	setSearchFilter(filter: string) {
		// Validate search term length to prevent performance issues
		if (filter.length > 200) {
			filter = filter.substring(0, 200);
		}

		// Clear any existing debounce timer
		if (this.searchDebounceTimer) {
			clearTimeout(this.searchDebounceTimer);
		}

		// Debounce the search operation to improve performance
		this.searchDebounceTimer = setTimeout(() => {
			this.searchFilter = filter;
			this.refresh(undefined);
			this.searchDebounceTimer = undefined;
		}, 150); // 150ms debounce delay - good balance between responsiveness and performance
	}

	getSearchFilter(): string {
		return this.searchFilter;
	}

	/**
	 * Clear the search filter immediately without debouncing.
	 * Use this when the user explicitly clears the search.
	 */
	clearSearchFilter(): void {
		// Clear any pending debounce timer
		if (this.searchDebounceTimer) {
			clearTimeout(this.searchDebounceTimer);
			this.searchDebounceTimer = undefined;
		}
		this.searchFilter = "";
		this.refresh(undefined);
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

		// Clear metadata cache when refreshing to ensure data consistency
		this.clearMetadataCache();

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
			this.storage.output.info(
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

		const oldWatcherIds = Object.keys(this.agentWatchers);
		const reusedWatcherIds: string[] = [];

		// TODO: I think it might make more sense for the tree items to contain
		// their own watchers, rather than recreate the tree items every time and
		// have this separate map held outside the tree.
		const showMetadata = this.getWorkspacesQuery === WorkspaceQuery.Mine;
		if (showMetadata) {
			const agents = extractAllAgents(resp.workspaces);
			agents.forEach((agent) => {
				// If we have an existing watcher, re-use it.
				if (this.agentWatchers[agent.id]) {
					reusedWatcherIds.push(agent.id);
					return this.agentWatchers[agent.id];
				}
				// Otherwise create a new watcher.
				const watcher = createAgentMetadataWatcher(agent.id, restClient);
				watcher.onChange(() => this.refresh());
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

		// Create tree items for each workspace
		const workspaceTreeItems = resp.workspaces.map((workspace: Workspace) => {
			const workspaceTreeItem = new WorkspaceTreeItem(
				workspace,
				this.getWorkspacesQuery === WorkspaceQuery.All,
				showMetadata,
			);

			// Get app status from the workspace agents
			const agents = extractAgents(workspace.latest_build.resources);
			agents.forEach((agent) => {
				// Check if agent has apps property with status reporting
				if (agent.apps && Array.isArray(agent.apps)) {
					workspaceTreeItem.appStatus = agent.apps.map((app: WorkspaceApp) => ({
						name: app.display_name,
						url: app.url,
						agent_id: agent.id,
						agent_name: agent.name,
						command: app.command,
						workspace_name: workspace.name,
					}));
				}
			});

			return workspaceTreeItem;
		});

		return workspaceTreeItems;
	}

	/**
	 * Either start or stop the refresh timer based on visibility.
	 *
	 * If we have never fetched workspaces and are visible, fetch immediately.
	 */
	setVisibility(visible: boolean) {
		this.visible = visible;
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
		// clear search debounce timer
		if (this.searchDebounceTimer) {
			clearTimeout(this.searchDebounceTimer);
			this.searchDebounceTimer = undefined;
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

	private _onDidChangeTreeData: vscode.EventEmitter<
		vscode.TreeItem | undefined | null | void
	> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<
		vscode.TreeItem | undefined | null | void
	> = this._onDidChangeTreeData.event;

	// refresh causes the tree to re-render.  It does not fetch fresh workspaces.
	refresh(item: vscode.TreeItem | undefined | null | void): void {
		this._onDidChangeTreeData.fire(item);
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
		if (element) {
			if (element instanceof WorkspaceTreeItem) {
				const agents = extractAgents(element.workspace.latest_build.resources);
				const agentTreeItems = agents.map(
					(agent) =>
						new AgentTreeItem(agent, element.workspace, element.watchMetadata),
				);

				return Promise.resolve(agentTreeItems);
			} else if (element instanceof AgentTreeItem) {
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
										workspace_name: element.workspace.name,
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
			} else if (element instanceof SectionTreeItem) {
				// Return the children of the section
				return Promise.resolve(element.children);
			}

			return Promise.resolve([]);
		}

		// Filter workspaces based on search term
		let filteredWorkspaces = this.workspaces || [];
		const trimmedFilter = this.searchFilter.trim();
		if (trimmedFilter) {
			const searchTerm = trimmedFilter.toLowerCase();
			filteredWorkspaces = filteredWorkspaces.filter((workspace) =>
				this.matchesSearchTerm(workspace, searchTerm),
			);
		}

		return Promise.resolve(filteredWorkspaces);
	}

	/**
	 * Extract and normalize searchable text fields from a workspace.
	 * This helper method reduces code duplication between exact word and substring matching.
	 */
	private extractSearchableFields(workspace: WorkspaceTreeItem): {
		workspaceName: string;
		ownerName: string;
		templateName: string;
		status: string;
		agentNames: string[];
		agentMetadataText: string;
	} {
		// Handle null/undefined workspace data safely
		const workspaceName = workspace.workspace.name.toLowerCase();
		const ownerName = workspace.workspace.owner_name.toLowerCase();
		const templateName = (
			workspace.workspace.template_display_name ||
			workspace.workspace.template_name
		).toLowerCase();
		const status = (
			workspace.workspace.latest_build.status || ""
		).toLowerCase();

		// Extract agent names with null safety
		const agents = extractAgents(workspace.workspace.latest_build.resources);
		const agentNames = agents
			.map((agent) => agent.name.toLowerCase())
			.filter((name) => name.length > 0);

		// Extract and cache agent metadata with error handling
		let agentMetadataText = "";
		const metadataCacheKey = agents.map((agent) => agent.id).join(",");

		if (this.metadataCache[metadataCacheKey]) {
			agentMetadataText = this.metadataCache[metadataCacheKey];
		} else {
			const metadataStrings: string[] = [];
			let hasSerializationErrors = false;

			agents.forEach((agent) => {
				const watcher = this.agentWatchers[agent.id];
				if (watcher?.metadata) {
					watcher.metadata.forEach((metadata) => {
						try {
							metadataStrings.push(JSON.stringify(metadata).toLowerCase());
						} catch (error) {
							hasSerializationErrors = true;
							// Handle JSON serialization errors gracefully
							this.storage.output.warn(
								`Failed to serialize metadata for agent ${agent.id}: ${error}`,
							);
						}
					});
				}
			});

			agentMetadataText = metadataStrings.join(" ");

			// Only cache if all metadata serialized successfully
			if (!hasSerializationErrors) {
				this.metadataCache[metadataCacheKey] = agentMetadataText;
			}
		}

		return {
			workspaceName,
			ownerName,
			templateName,
			status,
			agentNames,
			agentMetadataText,
		};
	}

	/**
	 * Check if a workspace matches the given search term using smart search logic.
	 * Prioritizes exact word matches over substring matches.
	 */
	private matchesSearchTerm(
		workspace: WorkspaceTreeItem,
		searchTerm: string,
	): boolean {
		// Early return for empty search terms
		if (!searchTerm || searchTerm.trim().length === 0) {
			return true;
		}

		// Extract all searchable fields once
		const fields = this.extractSearchableFields(workspace);

		// Pre-compile regex patterns for exact word matching
		const searchWords = searchTerm
			.split(/\s+/)
			.filter((word) => word.length > 0);

		const regexPatterns: RegExp[] = [];
		for (const word of searchWords) {
			// Simple word boundary search
			regexPatterns.push(new RegExp(`\\b${word}\\b`, "i"));
		}

		// Combine all text for exact word matching
		const allText = [
			fields.workspaceName,
			fields.ownerName,
			fields.templateName,
			fields.status,
			...fields.agentNames,
			fields.agentMetadataText,
		].join(" ");

		// Check for exact word matches (higher priority)
		const hasExactWordMatch =
			regexPatterns.length > 0 &&
			regexPatterns.some((pattern) => pattern.test(allText));

		// Check for substring matches (lower priority) - only if no exact word match
		const hasSubstringMatch =
			!hasExactWordMatch && allText.includes(searchTerm);

		// Return true if either exact word match or substring match
		return hasExactWordMatch || hasSubstringMatch;
	}

	/**
	 * Clear the metadata cache when workspaces are refreshed to ensure data consistency.
	 * Also clears cache if it grows too large to prevent memory issues.
	 */
	private clearMetadataCache(): void {
		// Clear cache if it grows too large (prevent memory issues)
		const cacheSize = Object.keys(this.metadataCache).length;
		if (cacheSize > 1000) {
			this.storage.output.info(
				`Clearing metadata cache due to size (${cacheSize} entries)`,
			);
		}
		this.metadataCache = {};
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

		public readonly workspace: Workspace,

		contextValue: CoderOpenableTreeItemType,
	) {
		super(label, collapsibleState);
		this.contextValue = contextValue;
		this.tooltip = tooltip;
		this.description = description;
	}

	iconPath = {
		light: path.join(__filename, "..", "..", "media", "logo-black.svg"),
		dark: path.join(__filename, "..", "..", "media", "logo-white.svg"),
	};
}

export class AgentTreeItem extends OpenableTreeItem {
	constructor(
		public readonly agent: WorkspaceAgent,
		workspace: Workspace,
		watchMetadata = false,
	) {
		super(
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
	public appStatus: {
		name: string;
		url?: string;
		agent_id?: string;
		agent_name?: string;
		command?: string;
		workspace_name?: string;
	}[] = [];

	constructor(
		workspace: Workspace,
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
		const agents = extractAgents(workspace.latest_build.resources);
		super(
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
