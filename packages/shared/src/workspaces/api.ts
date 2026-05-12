/**
 * Workspaces API - Type-safe message definitions for the Workspaces webview.
 *
 * Usage:
 * ```tsx
 * const ipc = useIpc();
 * const workspaces = await ipc.request(WorkspacesApi.getWorkspaces);
 * ipc.command(WorkspacesApi.openWorkspace, { workspaceId: "..." });
 * ```
 */

// import {
// 	defineCommand,
// 	defineNotification,
// 	defineRequest,
// } from "../ipc/protocol";

// TODO: Add workspace types as needed
// For now, this is an empty API to provide compile-time safety

export const WorkspacesApi = {
	// Requests will be added here as the feature is developed
	// Example: getWorkspaces: defineRequest<void, Workspace[]>("getWorkspaces"),
	// Commands will be added here as needed
	// Example: openWorkspace: defineCommand<{ workspaceId: string }>("openWorkspace"),
	// Notifications will be added here as needed
	// Example: refresh: defineNotification<void>("refresh"),
} as const;
