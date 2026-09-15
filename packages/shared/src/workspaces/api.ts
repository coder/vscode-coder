/**
 * Workspaces API - Type-safe message definitions for the Workspaces webview.
 *
 * The extension owns the data and pushes it; the webview renders what it is
 * given and sends back the actions the user takes.
 */

import { defineCommand, defineNotification } from "../ipc/protocol";

import type {
	OpenWorkspaceParams,
	SetFilterParams,
	ViewInDashboardParams,
	WatchAgentsParams,
	WorkspacesState,
} from "./types";

export const WorkspacesApi = {
	// Notifications
	/** The whole state, whenever any of it changes */
	stateChanged: defineNotification<WorkspacesState>("stateChanged"),
	// Commands
	/** Webview signals its subscription is live and asks for the state */
	ready: defineCommand<void>("ready"),
	openWorkspace: defineCommand<OpenWorkspaceParams>("openWorkspace"),
	viewInDashboard: defineCommand<ViewInDashboardParams>("viewInDashboard"),
	refresh: defineCommand<void>("refresh"),
	setFilter: defineCommand<SetFilterParams>("setFilter"),
	/** Watch metadata for these agents only, so idle rows cost nothing */
	watchAgents: defineCommand<WatchAgentsParams>("watchAgents"),
} as const;
