import * as vscode from "vscode";

/**
 * Manages a terminal and its associated write emitter as a single unit.
 * Ensures both are created together and disposed together properly.
 */
export class TerminalSession implements vscode.Disposable {
	public readonly writeEmitter: vscode.EventEmitter<string>;
	public readonly terminal: vscode.Terminal;

	constructor(name: string) {
		this.writeEmitter = new vscode.EventEmitter<string>();
		this.terminal = vscode.window.createTerminal({
			name,
			location: vscode.TerminalLocation.Panel,
			// Spin makes this gear icon spin!
			iconPath: new vscode.ThemeIcon("gear~spin"),
			pty: {
				onDidWrite: this.writeEmitter.event,
				close: () => undefined,
				open: () => undefined,
			},
		});
		this.terminal.show(true);
	}

	dispose(): void {
		try {
			this.writeEmitter.dispose();
		} catch {
			// Ignore disposal errors
		}
		try {
			this.terminal.dispose();
		} catch {
			// Ignore disposal errors
		}
	}
}
