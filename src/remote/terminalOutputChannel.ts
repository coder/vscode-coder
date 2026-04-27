import stripAnsi from "strip-ansi";
import * as vscode from "vscode";

/**
 * Wraps a VS Code OutputChannel for terminal-style output, stripping ANSI
 * escapes and carriage returns. The channel is created lazily on first write
 * to avoid surfacing an empty pane in the Output dropdown when nothing is
 * ever written.
 */
export class TerminalOutputChannel implements vscode.Disposable {
	private channel: vscode.OutputChannel | undefined;

	constructor(private readonly name: string) {}

	write(data: string): void {
		if (!this.channel) {
			this.channel = vscode.window.createOutputChannel(this.name);
			this.channel.show(true);
		}
		this.channel.append(stripAnsi(data).replace(/\r/g, ""));
	}

	dispose(): void {
		this.channel?.dispose();
	}
}
