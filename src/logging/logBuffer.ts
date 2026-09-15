import type { Logger } from "./logger";

/**
 * Numeric severities matching `vscode.LogLevel` (Off=0, Trace=1, Debug=2,
 * Info=3, Warning=4, Error=5). Kept as plain numbers so this module stays
 * free of the VS Code API and easy to test.
 */
const SEVERITY = {
	trace: 1,
	debug: 2,
	info: 3,
	warn: 4,
	error: 5,
} as const;

type Level = keyof typeof SEVERITY;

/** Sink methods that the output channel persists at any non-Off level. */
type ReplaySink = "info" | "warn" | "error";

/** The failure-time surface used by connection-failure call sites. */
export interface ConnectionLogBuffer {
	flush(reason: string): void;
}

interface LogEntry {
	readonly atMs: number;
	readonly level: Level;
	readonly message: string;
	readonly args: unknown[];
}

/**
 * Buffers entries below the current log level and replays them on failure at a
 * level the output channel persists.
 */
export class BufferingLogger implements Logger, ConnectionLogBuffer {
	private entries: LogEntry[] = [];

	public constructor(
		private readonly inner: Logger,
		private readonly channel: { readonly logLevel: number },
		private capacity: number,
	) {}

	public readonly trace = this.wrap("trace");
	public readonly debug = this.wrap("debug");
	public readonly info = this.wrap("info");
	public readonly warn = this.wrap("warn");
	public readonly error = this.wrap("error");

	public show(): void {
		this.inner.show();
	}

	/** Resize the ring, keeping the most recent entries. */
	public setCapacity(capacity: number): void {
		this.capacity = capacity;
		if (this.entries.length > this.capacity) {
			this.entries.splice(0, this.entries.length - this.capacity);
		}
	}

	/**
	 * Replay buffered entries into the sink and clear them. No-op when empty.
	 * Clearing the buffer means a later flush only replays entries accumulated
	 * since this one, so consecutive failures never duplicate entries.
	 */
	public flush(reason: string): void {
		// The channel writes nothing at Off, so replaying now would discard the
		// context. Keep it buffered until logging is turned back on.
		if (this.channel.logLevel === 0) {
			return;
		}
		if (this.entries.length === 0) {
			return;
		}
		const entries = this.entries;
		this.entries = [];

		const sink = this.replaySink();
		this.inner[sink](
			`[buffered] connection failure (${reason}): replaying ${entries.length} buffered entries`,
		);
		for (const entry of entries) {
			const line = `[buffered] ${new Date(entry.atMs).toISOString()} ${entry.level.toUpperCase()} ${entry.message}`;
			this.inner[sink](line.replaceAll("\n", "\n[buffered] "), ...entry.args);
		}
		this.inner[sink](`[buffered] end of buffered logs (${reason})`);
	}

	/** Pass a call through to the sink and buffer it when below the level. */
	private wrap(level: Level): (message: string, ...args: unknown[]) => void {
		return (message, ...args) => {
			this.record(level, message, args);
			this.inner[level](message, ...args);
		};
	}

	/**
	 * The least-verbose sink method that is still written at the current level,
	 * so a flush is captured whatever the user's log level.
	 */
	private replaySink(): ReplaySink {
		const level = this.channel.logLevel;
		if (level >= SEVERITY.error) {
			return "error";
		}
		if (level >= SEVERITY.warn) {
			return "warn";
		}
		return "info";
	}

	private record(level: Level, message: string, args: unknown[]): void {
		if (this.capacity === 0 || SEVERITY[level] >= this.channel.logLevel) {
			return;
		}
		this.entries.push({ atMs: Date.now(), level, message, args });
		if (this.entries.length > this.capacity) {
			this.entries.shift();
		}
	}
}
