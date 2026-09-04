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

const LEVEL_LABEL: Record<Level, string> = {
	trace: "TRACE",
	debug: "DEBUG",
	info: "INFO",
	warn: "WARN",
	error: "ERROR",
};

/** Reads the sink's effective log level (numeric, matching `vscode.LogLevel`). */
export interface LogLevelSource {
	getLogLevel(): number;
	onDidChangeLogLevel(listener: (level: number) => void): { dispose(): void };
}

/** The failure-time surface used by connection-failure call sites. */
export interface ConnectionLogBuffer {
	flush(reason: string): void;
}

interface BufferedEntry {
	readonly atMs: number;
	readonly level: Level;
	readonly message: string;
	readonly args: unknown[];
}

function normalizeCapacity(capacity: number): number {
	return Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : 0;
}

/**
 * Wraps a {@link Logger} and keeps a bounded, in-memory ring of entries whose
 * level is **below the sink's current level** — the ones the sink would
 * otherwise drop. On a connection failure, {@link flush} replays those entries
 * into the sink so they persist to disk (and any support bundle), giving Support
 * the debug detail leading up to the failure without the user having enabled
 * debug logging beforehand.
 *
 * Only below-level entries are buffered, so nothing that the sink already writes
 * is ever duplicated. Replay is emitted at the least-verbose level the sink
 * still writes, so the flush lands regardless of the configured level.
 */
export class BufferingLogger implements Logger, ConnectionLogBuffer {
	private entries: BufferedEntry[] = [];
	private capacity: number;
	private currentLevel: number;
	private lastFlushMs = Number.NEGATIVE_INFINITY;
	private readonly levelSubscription: { dispose(): void };

	public constructor(
		private readonly inner: Logger,
		private readonly levelSource: LogLevelSource,
		capacity: number,
		private readonly flushSuppressionMs = 5_000,
		private readonly now: () => number = Date.now,
	) {
		this.capacity = normalizeCapacity(capacity);
		this.currentLevel = levelSource.getLogLevel();
		this.levelSubscription = levelSource.onDidChangeLogLevel((level) => {
			this.currentLevel = level;
		});
	}

	public trace(message: string, ...args: unknown[]): void {
		this.record("trace", message, args);
		this.inner.trace(message, ...args);
	}

	public debug(message: string, ...args: unknown[]): void {
		this.record("debug", message, args);
		this.inner.debug(message, ...args);
	}

	public info(message: string, ...args: unknown[]): void {
		this.record("info", message, args);
		this.inner.info(message, ...args);
	}

	public warn(message: string, ...args: unknown[]): void {
		this.record("warn", message, args);
		this.inner.warn(message, ...args);
	}

	public error(message: string, ...args: unknown[]): void {
		this.record("error", message, args);
		this.inner.error(message, ...args);
	}

	public show(): void {
		this.inner.show();
	}

	/** Resize the ring, keeping the most recent entries. */
	public setCapacity(capacity: number): void {
		this.capacity = normalizeCapacity(capacity);
		if (this.entries.length > this.capacity) {
			this.entries.splice(0, this.entries.length - this.capacity);
		}
	}

	/**
	 * Replay buffered entries into the sink and clear them. No-op when empty or
	 * when called again within the suppression window (one outage often trips
	 * several failure signals at once).
	 */
	public flush(reason: string): void {
		const now = this.now();
		if (now - this.lastFlushMs < this.flushSuppressionMs) {
			return;
		}
		if (this.entries.length === 0) {
			return;
		}
		this.lastFlushMs = now;
		const entries = this.entries;
		this.entries = [];

		const emit = this.replayEmitter();
		emit(
			`[buffered] connection failure (${reason}): replaying ${entries.length} buffered log line(s)`,
		);
		for (const entry of entries) {
			emit(
				`[buffered] ${new Date(entry.atMs).toISOString()} ${LEVEL_LABEL[entry.level]} ${entry.message}`,
				...entry.args,
			);
		}
		emit(`[buffered] end of buffered logs (${reason})`);
	}

	public dispose(): void {
		this.levelSubscription.dispose();
	}

	/**
	 * The least-verbose sink method that is still written at the current level,
	 * so a flush is captured whatever the user's log level (except Off, where the
	 * sink writes nothing).
	 */
	private replayEmitter(): (message: string, ...args: unknown[]) => void {
		const level = this.levelSource.getLogLevel();
		if (level >= SEVERITY.error) {
			return (message, ...args) => this.inner.error(message, ...args);
		}
		if (level >= SEVERITY.warn) {
			return (message, ...args) => this.inner.warn(message, ...args);
		}
		return (message, ...args) => this.inner.info(message, ...args);
	}

	private record(level: Level, message: string, args: unknown[]): void {
		if (this.capacity === 0 || SEVERITY[level] >= this.currentLevel) {
			return;
		}
		this.entries.push({ atMs: this.now(), level, message, args });
		if (this.entries.length > this.capacity) {
			this.entries.shift();
		}
	}
}
