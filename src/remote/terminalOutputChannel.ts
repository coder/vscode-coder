import * as vscode from "vscode";

/** Adapts terminal-style output (\r\n) for a VS Code OutputChannel (\n). */
export class TerminalOutputChannel implements vscode.Disposable {
	private readonly channel: vscode.OutputChannel;

	constructor(name: string) {
		this.channel = vscode.window.createOutputChannel(name);
		this.channel.show(true);
	}

	write(data: string): void {
		this.channel.append(data.replace(/\r/g, ""));
	}

	dispose(): void {
		this.channel.dispose();
	}
}
