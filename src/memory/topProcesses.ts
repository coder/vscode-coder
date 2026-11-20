import * as vscode from "vscode";

import { vscodeProposed } from "../vscode/proposed";

// procps top sorts by memory with -o; BusyBox and old procps have no -o, so
// probe it once and fall back to the default order. Without top, wait for a
// key and exit 0, so the message stays readable instead of VS Code reporting
// a failed launch.
const TOP_SCRIPT = [
	"if ! command -v top >/dev/null 2>&1; then",
	'  echo "top is not installed on this workspace."',
	'  printf "Press Enter to close."; read -r _; exit 0',
	"fi",
	"if top -b -n 1 -o %MEM >/dev/null 2>&1; then exec top -o %MEM; fi",
	"exec top",
].join("\n");

let terminal: vscode.Terminal | undefined;

/**
 * Shows `top`, sorted by memory, in a terminal on the connected workspace,
 * reusing the one already open. A terminal without a `cwd` runs on the
 * window's remote, and the script is fixed, so no deployment-provided value
 * reaches a shell.
 */
export function showTopProcesses(): void {
	if (!vscodeProposed.env.remoteAuthority) {
		void vscode.window.showInformationMessage(
			"Connect to a workspace to show its top processes.",
		);
		return;
	}
	if (
		!terminal ||
		terminal.exitStatus !== undefined ||
		!vscode.window.terminals.includes(terminal)
	) {
		terminal = vscode.window.createTerminal({
			name: "Top Processes",
			shellPath: "/bin/sh",
			shellArgs: ["-c", TOP_SCRIPT],
		});
	}
	terminal.show();
}
