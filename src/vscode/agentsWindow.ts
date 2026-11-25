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

/** Missing in VS Code versions and forks without the Agents window. */
const OPEN_AGENTS_WINDOW_COMMAND = "workbench.action.openAgentsWindow";

/** Whether this editor can open the Agents window. */
export async function canOpenAgentsWindow(): Promise<boolean> {
	const commands = await vscode.commands.getCommands(true);
	return commands.includes(OPEN_AGENTS_WINDOW_COMMAND);
}

/** Open the Agents window on `folderUri`, or on its last folder when undefined. */
export async function openAgentsWindow(
	folderUri: vscode.Uri | undefined,
): Promise<void> {
	// Without `reveal`, an Agents window that is already open ignores the folder.
	await vscode.commands.executeCommand(OPEN_AGENTS_WINDOW_COMMAND, {
		folderUri,
		reveal: "new",
	});
}
