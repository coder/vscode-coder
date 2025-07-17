import * as vscode from "vscode";

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	NONE = 2,
}

export interface LogAdapter {
	write(message: string): void;
	clear(): void;
}

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

export class ArrayAdapter implements LogAdapter {
	private logs: string[] = [];

	write(message: string): void {
		this.logs.push(message);
	}

	clear(): void {
		this.logs = [];
	}

	getSnapshot(): readonly string[] {
		return [...this.logs];
	}
}

export class NoOpAdapter implements LogAdapter {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	write(_message: string): void {
		// Intentionally empty - baseline for performance tests
	}

	clear(): void {
		// Intentionally empty - baseline for performance tests
	}
}

class LoggerImpl {
	private adapter: LogAdapter | null = null;
	private level: LogLevel = LogLevel.INFO;
	private configListener: vscode.Disposable | null = null;

	constructor() {
		this.updateLogLevel();
		this.setupConfigListener();
	}

	private setupConfigListener(): void {
		// In test environment, vscode.workspace might not be available
		if (!vscode.workspace?.onDidChangeConfiguration) {
			return;
		}
		this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("coder.verbose")) {
				this.updateLogLevel();
			}
		});
	}

	private updateLogLevel(): void {
		// In test environment, vscode.workspace might not be available
		if (!vscode.workspace?.getConfiguration) {
			this.level = LogLevel.INFO;
			return;
		}
		const config = vscode.workspace.getConfiguration("coder");
		const verbose = config.get<boolean>("verbose", false);
		this.level = verbose ? LogLevel.DEBUG : LogLevel.INFO;
	}

	private formatMessage(message: string, level: LogLevel): string {
		const levelStr = LogLevel[level].toLowerCase();
		const timestamp = new Date().toISOString();
		let formatted = `[${levelStr}] ${timestamp} ${message}`;

		// Add source location for debug messages when verbose is enabled
		if (level === LogLevel.DEBUG && this.level === LogLevel.DEBUG) {
			const stack = new Error().stack;
			if (stack) {
				const lines = stack.split("\n");
				// Find the first line that's not from the logger itself
				for (let i = 2; i < lines.length; i++) {
					const line = lines[i];
					if (!line.includes("logger.ts") && !line.includes("Logger.")) {
						const match =
							line.match(/at\s+(.+)\s+\((.+):(\d+):(\d+)\)/) ||
							line.match(/at\s+(.+):(\d+):(\d+)/);
						if (match) {
							const location =
								match.length === 5
									? `${match[1]} (${match[2]}:${match[3]})`
									: `${match[1]}:${match[2]}`;
							formatted += `\n  at ${location}`;
						}
						break;
					}
				}
			}
		}

		return formatted;
	}

	log(message: string, severity: LogLevel = LogLevel.INFO): void {
		if (!this.adapter || severity < this.level) {
			return;
		}

		const formatted = this.formatMessage(message, severity);
		this.adapter.write(formatted);
	}

	debug(message: string): void {
		this.log(message, LogLevel.DEBUG);
	}

	info(message: string): void {
		this.log(message, LogLevel.INFO);
	}

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	setAdapter(adapter: LogAdapter): void {
		if (process.env.NODE_ENV !== "test") {
			throw new Error("setAdapter can only be called in test environment");
		}
		if (this.adapter !== null) {
			throw new Error(
				"Adapter already set. Use reset() first or withAdapter() for temporary changes",
			);
		}
		this.adapter = adapter;
	}

	withAdapter<T>(adapter: LogAdapter, fn: () => T): T {
		const previous = this.adapter;
		this.adapter = adapter;
		try {
			return fn();
		} finally {
			this.adapter = previous;
		}
	}

	reset(): void {
		if (process.env.NODE_ENV !== "test") {
			throw new Error("reset can only be called in test environment");
		}
		this.adapter = null;
		this.level = LogLevel.INFO;
		if (this.configListener) {
			this.configListener.dispose();
			this.configListener = null;
		}
		// Re-setup config listener for next test
		this.updateLogLevel();
		this.setupConfigListener();
	}

	// Initialize with OutputChannel for production use
	initialize(outputChannel: vscode.OutputChannel): void {
		if (this.adapter !== null) {
			throw new Error("Logger already initialized");
		}
		this.adapter = new OutputChannelAdapter(outputChannel);
	}
}

// Export singleton instance
export const logger = new LoggerImpl();

// Export types for testing
export type Logger = typeof logger;
