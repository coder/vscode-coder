export interface LogEntry {
	level: string;
	message: string;
	timestamp: Date;
	data?: unknown;
}

export interface OutputChannel {
	appendLine(value: string): void;
}

export interface LoggerOptions {
	verbose?: boolean;
}

export class Logger {
	private logs: LogEntry[] = [];
	private readonly options: LoggerOptions;

	constructor(
		private readonly outputChannel?: OutputChannel,
		options: LoggerOptions = {},
	) {
		this.options = { verbose: false, ...options };
	}

	error(message: string, data?: unknown): void {
		const entry: LogEntry = {
			level: "ERROR",
			message,
			timestamp: new Date(),
			data,
		};
		this.logs.push(entry);
		this.writeToOutput(entry);
	}

	warn(message: string, data?: unknown): void {
		const entry: LogEntry = {
			level: "WARN",
			message,
			timestamp: new Date(),
			data,
		};
		this.logs.push(entry);
		this.writeToOutput(entry);
	}

	info(message: string, data?: unknown): void {
		const entry: LogEntry = {
			level: "INFO",
			message,
			timestamp: new Date(),
			data,
		};
		this.logs.push(entry);
		this.writeToOutput(entry);
	}

	debug(message: string, data?: unknown): void {
		const entry: LogEntry = {
			level: "DEBUG",
			message,
			timestamp: new Date(),
			data,
		};
		this.logs.push(entry);
		this.writeToOutput(entry);
	}

	getLogs(): readonly LogEntry[] {
		return this.logs;
	}

	clear(): void {
		this.logs = [];
	}

	private writeToOutput(entry: LogEntry): void {
		if (this.outputChannel) {
			// Filter debug logs when verbose is false
			if (entry.level === "DEBUG" && !this.options.verbose) {
				return;
			}

			const timestamp = entry.timestamp.toISOString();
			let message = `[${timestamp}] [${entry.level}] ${entry.message}`;

			// Append data if provided
			if (entry.data !== undefined) {
				try {
					message += ` ${JSON.stringify(entry.data)}`;
				} catch (error) {
					message += ` [Data serialization error]`;
				}
			}

			this.outputChannel.appendLine(message);
		}
	}

	/**
	 * Backward compatibility method for existing code using writeToCoderOutputChannel
	 * Logs messages at INFO level
	 */
	writeToCoderOutputChannel(message: string): void {
		this.info(message);
	}
}

export interface WorkspaceConfiguration {
	getConfiguration(section: string): {
		get<T>(key: string): T | undefined;
	};
}

export class LoggerService {
	constructor(
		private readonly outputChannel: OutputChannel,
		private readonly workspace: WorkspaceConfiguration,
	) {}

	createLogger(): Logger {
		const config = this.workspace.getConfiguration("coder");
		const verbose = config.get<boolean>("verbose") ?? false;

		return new Logger(this.outputChannel, { verbose });
	}
}
