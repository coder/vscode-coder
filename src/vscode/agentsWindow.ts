import * as path from "node:path";
import * as vscode from "vscode";

/**
 * VS Code opens this workspace in the Agents window and marks a window as the
 * Agents window by this path. `workspace.isAgentSessionsWorkspace` exposes the
 * same flag but is a proposed API, so extensions cannot read it on Stable.
 */
const AGENTS_WINDOW_WORKSPACE_FILE = "agent-sessions.code-workspace";

/** Whether this extension host runs in VS Code's Agents window. */
export function isAgentsWindow(): boolean {
	const workspaceFile = vscode.workspace.workspaceFile;
	return (
		workspaceFile?.scheme === "file" &&
		path.posix.basename(workspaceFile.path) === AGENTS_WINDOW_WORKSPACE_FILE
	);
}
