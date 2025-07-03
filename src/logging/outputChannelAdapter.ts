import * as vscode from "vscode";
import { LogAdapter } from "../logger";

export class OutputChannelAdapter implements LogAdapter {
	constructor(private outputChannel: vscode.OutputChannel) {}

	write(message: string): void {
		try {
			this.outputChannel.appendLine(message);
		} catch {
			// Silently ignore - channel may be disposed
		}
	}

	clear(): void {
		try {
			this.outputChannel.clear();
		} catch {
			// Silently ignore - channel may be disposed
		}
	}
}
