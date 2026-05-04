import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { watchConfigurationChanges } from "../../configWatcher";
import { cleanupFiles } from "../../util/fileCleanup";

import type { Logger } from "../../logging/logger";
import type { TelemetryEvent, TelemetryLevel, TelemetrySink } from "../event";

const SINK_NAME = "local-jsonl";
const FILE_PREFIX = "telemetry-";
const FILE_SUFFIX = ".jsonl";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SETTING_NAME = "coder.telemetry.localJsonl";

const DEFAULTS: LocalJsonlConfig = {
	flushIntervalMs: 15_000,
	flushBatchSize: 100,
	bufferLimit: 500,
	maxFileBytes: 5 * 1024 * 1024,
	maxAgeDays: 30,
	maxTotalBytes: 100 * 1024 * 1024,
};

export interface LocalJsonlSinkOptions {
	baseDir: string;
	sessionId: string;
}

export interface LocalJsonlConfig {
	flushIntervalMs: number;
	flushBatchSize: number;
	bufferLimit: number;
	maxFileBytes: number;
	maxAgeDays: number;
	maxTotalBytes: number;
}

interface CurrentFile {
	date: string;
	segment: number;
	size: number;
}

/**
 * Writes telemetry events as JSON Lines.
 *
 * Each session writes its own files (`telemetry-YYYY-MM-DD-{sessionId8}.jsonl`,
 * with `.N.jsonl` suffixes added once `maxFileBytes` is exceeded), so multiple
 * VS Code windows sharing globalStorage cannot race on appends or rotation.
 * Cleanup runs across every session's files for shared retention.
 *
 * `write` is synchronous and never throws. Disk I/O happens in `flush` and
 * `dispose`, which catch errors and log them via the provided logger.
 *
 * Tunables come from the `coder.telemetry.localJsonl` setting (object-typed,
 * not registered in package.json) and update reactively.
 */
export class LocalJsonlSink implements TelemetrySink {
	public readonly name = SINK_NAME;
	public readonly minLevel: TelemetryLevel = "local";

	readonly #baseDir: string;
	readonly #sessionSlug: string;
	readonly #logger: Logger;
	readonly #buffer: string[] = [];
	readonly #configWatcher: vscode.Disposable;
	#config: LocalJsonlConfig;
	#flushTimer: NodeJS.Timeout | null = null;
	#flushChain: Promise<void> = Promise.resolve();
	#hasQueued = false;
	#current: CurrentFile = { date: "", segment: 0, size: 0 };
	#disposed = false;
	#overflowWarned = false;

	private constructor(
		opts: LocalJsonlSinkOptions,
		config: LocalJsonlConfig,
		logger: Logger,
	) {
		this.#baseDir = opts.baseDir;
		this.#sessionSlug = toSessionSlug(opts.sessionId);
		this.#logger = logger;
		this.#config = config;
		this.#configWatcher = watchConfigurationChanges(
			[{ setting: SETTING_NAME, getValue: readConfig }],
			(changes) => {
				const next = changes.get(SETTING_NAME) as LocalJsonlConfig | undefined;
				if (next) {
					this.#config = next;
				}
			},
		);
		this.#scheduleNextFlush();
	}

	public static start(
		opts: LocalJsonlSinkOptions,
		logger: Logger,
	): LocalJsonlSink {
		const config = readConfig();
		const sink = new LocalJsonlSink(opts, config, logger);
		void cleanupOldTelemetryFiles(opts.baseDir, config, logger);
		return sink;
	}

	public write(event: TelemetryEvent): void {
		if (this.#disposed) {
			return;
		}
		let line: string;
		try {
			line = serializeEvent(event);
		} catch (err) {
			this.#logger.warn(`Telemetry sink '${this.name}' serialize failed`, err);
			return;
		}
		this.#buffer.push(line);

		if (this.#buffer.length > this.#config.bufferLimit) {
			const dropped = this.#buffer.length - this.#config.bufferLimit;
			this.#buffer.splice(0, dropped);
			if (!this.#overflowWarned) {
				this.#overflowWarned = true;
				this.#logger.warn(
					`Telemetry sink '${this.name}' buffer overflow: dropped ${dropped} oldest event(s)`,
				);
			}
		}

		if (this.#buffer.length >= this.#config.flushBatchSize) {
			void this.flush();
		}
	}

	/**
	 * Coalesces concurrent flush requests. While a flush is running, at most
	 * one more is queued; further callers receive that same queued promise.
	 * Resolves once the buffer state at the time of the call has been written
	 * (or attempted; failures are logged, not thrown).
	 */
	public flush(): Promise<void> {
		if (this.#hasQueued) {
			return this.#flushChain;
		}
		this.#hasQueued = true;
		const next = (): Promise<void> => {
			this.#hasQueued = false;
			return this.#doFlush();
		};
		this.#flushChain = this.#flushChain.then(next, next);
		return this.#flushChain;
	}

	public async dispose(): Promise<void> {
		if (this.#disposed) {
			return;
		}
		this.#disposed = true;
		this.#configWatcher.dispose();
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}
		await this.flush();
	}

	#scheduleNextFlush(): void {
		if (this.#disposed) {
			return;
		}
		this.#flushTimer = setTimeout(() => {
			this.flush()
				.catch((err) => {
					this.#logger.warn(
						`Telemetry sink '${this.name}' scheduled flush failed`,
						err,
					);
				})
				.finally(() => {
					this.#scheduleNextFlush();
				});
		}, this.#config.flushIntervalMs);
	}

	async #doFlush(): Promise<void> {
		if (this.#buffer.length === 0) {
			return;
		}
		const lines = this.#buffer.splice(0);
		const payload = lines.join("");
		const next = this.#nextFile(payload.length);
		const target = path.join(this.#baseDir, this.#fileName(next));
		try {
			await fs.appendFile(target, payload, "utf8");
			this.#current = { ...next, size: next.size + payload.length };
			this.#overflowWarned = false;
		} catch (err) {
			this.#logger.warn(`Telemetry sink '${this.name}' flush failed`, err);
		}
	}

	#nextFile(payloadSize: number): CurrentFile {
		const today = todayUtc();
		if (this.#current.date !== today) {
			return { date: today, segment: 0, size: 0 };
		}
		if (
			this.#current.size > 0 &&
			this.#current.size + payloadSize > this.#config.maxFileBytes
		) {
			return { date: today, segment: this.#current.segment + 1, size: 0 };
		}
		return this.#current;
	}

	#fileName(file: CurrentFile): string {
		const segment = file.segment > 0 ? `.${file.segment}` : "";
		return `${FILE_PREFIX}${file.date}-${this.#sessionSlug}${segment}${FILE_SUFFIX}`;
	}
}

async function cleanupOldTelemetryFiles(
	baseDir: string,
	config: LocalJsonlConfig,
	logger: Logger,
): Promise<void> {
	try {
		await fs.mkdir(baseDir, { recursive: true });
	} catch (err) {
		logger.warn(`Telemetry sink '${SINK_NAME}' could not create base dir`, err);
		return;
	}
	const maxAgeMs = config.maxAgeDays * MS_PER_DAY;
	const { maxTotalBytes } = config;
	await cleanupFiles(baseDir, logger, {
		fileType: "telemetry file",
		match: (name) => name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX),
		pick: (files, now) => {
			const toDelete: Array<{ name: string }> = [];
			const fresh: typeof files = [];
			let total = 0;
			for (const f of files) {
				if (now - f.mtime > maxAgeMs) {
					toDelete.push({ name: f.name });
				} else {
					fresh.push(f);
					total += f.size;
				}
			}
			fresh.sort((a, b) => a.mtime - b.mtime);
			for (const f of fresh) {
				if (total <= maxTotalBytes) {
					break;
				}
				toDelete.push({ name: f.name });
				total -= f.size;
			}
			return toDelete;
		},
	});
}

/** Reads `coder.telemetry.localJsonl`, falling back to defaults for invalid values. */
function readConfig(): LocalJsonlConfig {
	const raw = vscode.workspace.getConfiguration().get(SETTING_NAME);
	const obj =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	return {
		flushIntervalMs: positiveNumber(
			obj.flushIntervalMs,
			DEFAULTS.flushIntervalMs,
		),
		flushBatchSize: positiveNumber(obj.flushBatchSize, DEFAULTS.flushBatchSize),
		bufferLimit: positiveNumber(obj.bufferLimit, DEFAULTS.bufferLimit),
		maxFileBytes: positiveNumber(obj.maxFileBytes, DEFAULTS.maxFileBytes),
		maxAgeDays: positiveNumber(obj.maxAgeDays, DEFAULTS.maxAgeDays),
		maxTotalBytes: positiveNumber(obj.maxTotalBytes, DEFAULTS.maxTotalBytes),
	};
}

function positiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && value > 0 ? value : fallback;
}

function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

function toSessionSlug(sessionId: string): string {
	const cleaned = sessionId.replace(/[^a-zA-Z0-9]/g, "");
	return cleaned.slice(0, 8) || "anon0000";
}

function serializeEvent(event: TelemetryEvent): string {
	const out: Record<string, unknown> = {
		event_id: event.eventId,
		event_name: event.eventName,
		timestamp: event.timestamp,
		event_sequence: event.eventSequence,
		context: {
			extension_version: event.context.extensionVersion,
			machine_id: event.context.machineId,
			session_id: event.context.sessionId,
			os_type: event.context.osType,
			os_version: event.context.osVersion,
			host_arch: event.context.hostArch,
			platform_name: event.context.platformName,
			platform_version: event.context.platformVersion,
			deployment_url: event.context.deploymentUrl,
		},
		properties: event.properties,
		measurements: event.measurements,
	};
	if (event.traceId !== undefined) {
		out.trace_id = event.traceId;
	}
	if (event.parentEventId !== undefined) {
		out.parent_event_id = event.parentEventId;
	}
	if (event.error !== undefined) {
		out.error = event.error;
	}
	return JSON.stringify(out) + "\n";
}
