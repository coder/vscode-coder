import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceAgentMetadata,
} from "coder/site/src/api/typesGenerated";

// Re-export SDK types for convenience
export type { Workspace, WorkspaceAgent, WorkspaceAgentMetadata };

export type WorkspaceFilter = "mine" | "shared" | "all";

/** A workspace page in the dashboard, opened in the browser. */
export type DashboardPage = "workspace" | "settings";

/** What the panel may offer for the current session. */
export interface WorkspacesCapabilities {
	readonly authenticated: boolean;
	/** Filters the user may select, in display order. */
	readonly filters: readonly WorkspaceFilter[];
}

export interface FilteredWorkspaces {
	readonly filter: WorkspaceFilter;
	readonly workspaces: readonly Workspace[];
	/** True while the first list for this filter is still on its way. */
	readonly loading: boolean;
}

export interface AgentMetadataState {
	readonly metadata: readonly WorkspaceAgentMetadata[];
	/** The watcher failure, which replaces the metadata in the UI. */
	readonly error: string | null;
	/** True until the agent reports for the first time. */
	readonly loading: boolean;
}

/** Keyed by agent id. */
export type AgentMetadataMap = Readonly<Record<string, AgentMetadataState>>;

/** Everything the panel renders. Fields are replaced, never mutated. */
export interface WorkspacesState {
	readonly capabilities: WorkspacesCapabilities;
	readonly workspaces: FilteredWorkspaces;
	readonly metadata: AgentMetadataMap;
	readonly error: string | null;
}

/** A state slice: present fields changed, absent ones did not. */
export type WorkspacesUpdate = Partial<WorkspacesState>;

export interface OpenWorkspaceParams {
	workspaceId: string;
	/** Which agent to connect to. Picked interactively when omitted. */
	agentId?: string;
}

export interface ViewInDashboardParams {
	workspaceId: string;
	page: DashboardPage;
}

export interface SetFilterParams {
	filter: WorkspaceFilter;
}

export interface WatchAgentsParams {
	/** The agents whose metadata the webview is showing. */
	agentIds: readonly string[];
}
