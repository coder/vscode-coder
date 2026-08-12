import type * as vscode from "vscode";

import type { Logger } from "./logger";

/**
 * Wraps a {@link Logger} and prefixes every message with the session ID so all
 * log lines produced during a session can be correlated by searching for a
 * single ID.
 */
export class SessionLogger implements Logger {
	constructor(
		private readonly outputChannel: vscode.LogOutputChannel,
		private readonly sessionId: string,
	) {}

	private prefix(message: string): string {
		return `[${this.sessionId}] ${message}`;
	}

	trace(message: string, ...args: unknown[]): void {
		this.outputChannel.trace(this.prefix(message), ...args);
	}

	debug(message: string, ...args: unknown[]): void {
		this.outputChannel.debug(this.prefix(message), ...args);
	}

	info(message: string, ...args: unknown[]): void {
		this.outputChannel.info(this.prefix(message), ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.outputChannel.warn(this.prefix(message), ...args);
	}

	error(message: string, ...args: unknown[]): void {
		this.outputChannel.error(this.prefix(message), ...args);
	}

	show(): void {
		this.outputChannel.show();
	}
}
