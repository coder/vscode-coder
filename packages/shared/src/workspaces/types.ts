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

/**
 * What the list is doing. `loading` is set only for a list the user waits on:
 * the first one for a filter, or a refresh. Polls never set it.
 */
export type WorkspaceListStatus =
	| { readonly kind: "loading" }
	| { readonly kind: "ready" }
	| { readonly kind: "failed"; readonly error: string };

/** What one agent reports. A failure replaces its metadata in the UI. */
export type AgentMetadataState =
	| { readonly kind: "pending" }
	| {
			readonly kind: "reported";
			readonly metadata: readonly WorkspaceAgentMetadata[];
	  }
	| { readonly kind: "failed"; readonly error: string };

/** Keyed by agent id. */
export type AgentMetadataMap = Readonly<Record<string, AgentMetadataState>>;

/** Everything the panel renders. Pushed whole whenever any of it changes. */
export interface WorkspacesState {
	readonly capabilities: WorkspacesCapabilities;
	readonly filter: WorkspaceFilter;
	readonly workspaces: readonly Workspace[];
	readonly status: WorkspaceListStatus;
	readonly metadata: AgentMetadataMap;
}

export interface OpenWorkspaceParams {
	readonly workspaceId: string;
	/** Which agent to connect to. Picked interactively when omitted. */
	readonly agentId?: string;
}

export interface ViewInDashboardParams {
	readonly workspaceId: string;
	readonly page: DashboardPage;
}

export interface SetFilterParams {
	readonly filter: WorkspaceFilter;
}

export interface WatchAgentsParams {
	/** The agents whose metadata the webview is showing. */
	readonly agentIds: readonly string[];
}
