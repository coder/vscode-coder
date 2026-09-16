import { safeStringify } from "./utils";

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

/**
 * Character budget for the buffered text, independent of the entry count. Bounds
 * worst-case memory when `httpClientLogLevel: body` makes each entry large.
 */
const MAX_BUFFERED_CHARS = 2_000_000;

/** Entries replayed per channel call, so a flush is not one RPC per entry. */
const REPLAY_CHUNK = 100;

/** Replays buffered below-level log entries on a connection failure. */
export interface ConnectionLogBuffer {
	flush(reason: string, options?: { readonly retain?: boolean }): void;
}

interface LogEntry {
	readonly atMs: number;
	readonly level: Level;
	/** Message and args formatted once at record time; holds no live references. */
	readonly text: string;
}

/**
 * Buffers entries below the current log level and replays them on failure at a
 * level the output channel persists.
 */
export class BufferingLogger implements Logger, ConnectionLogBuffer {
	private entries: LogEntry[] = [];
	private chars = 0;

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

	/** Resize the ring, keeping the most recent entries within both budgets. */
	public setCapacity(capacity: number): void {
		this.capacity = capacity;
		this.trim();
	}

	/**
	 * Replay buffered entries into the sink. No-op when empty. Clears the ring by
	 * default, so consecutive failures never replay the same entries twice; pass
	 * `retain` for a snapshot flush (a support bundle) that must not disturb a
	 * later failure flush.
	 */
	public flush(
		reason: string,
		options: { readonly retain?: boolean } = {},
	): void {
		// The channel writes nothing at Off. Keep the entries for the next flush;
		// nothing new is recorded while Off.
		if (this.channel.logLevel === 0) {
			return;
		}
		if (this.entries.length === 0) {
			return;
		}
		const entries = this.entries;
		if (!options.retain) {
			this.entries = [];
			this.chars = 0;
		}

		const sink = this.replaySink();
		this.inner[sink](
			`[buffered] replaying ${entries.length} buffered entries (${reason})`,
		);
		const lines = entries.map((entry) =>
			`[buffered] ${new Date(entry.atMs).toISOString()} ${entry.level.toUpperCase()} ${entry.text}`.replaceAll(
				"\n",
				"\n[buffered] ",
			),
		);
		for (let i = 0; i < lines.length; i += REPLAY_CHUNK) {
			this.inner[sink](lines.slice(i, i + REPLAY_CHUNK).join("\n"));
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
	 * so replayed entries are persisted rather than dropped again.
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
		const text = [message, ...args.map((arg) => safeStringify(arg) ?? "")].join(
			" ",
		);
		this.entries.push({ atMs: Date.now(), level, text });
		this.chars += text.length;
		this.trim();
	}

	/** Evict oldest entries until both the count and character budgets hold. */
	private trim(): void {
		while (
			this.entries.length > this.capacity ||
			this.chars > MAX_BUFFERED_CHARS
		) {
			const removed = this.entries.shift();
			if (removed === undefined) {
				break;
			}
			this.chars -= removed.text.length;
		}
	}
}
