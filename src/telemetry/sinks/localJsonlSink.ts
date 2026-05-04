import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { watchConfigurationChanges } from "../../configWatcher";
import {
	LOCAL_JSONL_SETTING,
	readLocalJsonlConfig,
	type LocalJsonlConfig,
} from "../../settings/telemetry";
import { cleanupFiles } from "../../util/fileCleanup";

import type { Logger } from "../../logging/logger";
import type { TelemetryEvent, TelemetryLevel, TelemetrySink } from "../event";

const SINK_NAME = "local-jsonl";
const FILE_PREFIX = "telemetry-";
const FILE_SUFFIX = ".jsonl";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface LocalJsonlSinkOptions {
	baseDir: string;
	sessionId: string;
}

interface CurrentFile {
	date: string;
	segment: number;
	size: number;
}

/**
 * Writes telemetry events as JSON Lines. Each VS Code session writes its
 * own files (`telemetry-YYYY-MM-DD-{sessionId8}.jsonl` plus `.N.jsonl` size
 * segments), so concurrent windows cannot race on appends or rotation.
 * `write` is sync and never throws; disk I/O happens in `flush` and
 * `dispose` and catches errors. Tunables come from `coder.telemetry.localJsonl`
 * and update reactively.
 */
export class LocalJsonlSink implements TelemetrySink, vscode.Disposable {
	public readonly name = SINK_NAME;
	public readonly minLevel: TelemetryLevel = "local";

	readonly #baseDir: string;
	readonly #sessionSlug: string;
	readonly #logger: Logger;
	readonly #buffer: string[] = [];
	#config: LocalJsonlConfig;
	#configWatcher: vscode.Disposable | null = null;
	#flushTimer: NodeJS.Timeout | null = null;
	#flushChain: Promise<void> = Promise.resolve();
	#hasQueued = false;
	#current: CurrentFile = { date: "", segment: 0, size: 0 };
	#disposed = false;
	#overflowWarned = false;

	private constructor(
		opts: LocalJsonlSinkOptions,
		logger: Logger,
		config: LocalJsonlConfig,
	) {
		this.#baseDir = opts.baseDir;
		this.#sessionSlug = toSessionSlug(opts.sessionId);
		this.#logger = logger;
		this.#config = config;
	}

	/** Constructs a sink and starts its timer, config watcher, and cleanup. */
	public static start(
		opts: LocalJsonlSinkOptions,
		logger: Logger,
	): LocalJsonlSink {
		const config = readLocalJsonlConfig(vscode.workspace.getConfiguration());
		const sink = new LocalJsonlSink(opts, logger, config);
		sink.#configWatcher = watchConfigurationChanges(
			[
				{
					setting: LOCAL_JSONL_SETTING,
					getValue: () =>
						readLocalJsonlConfig(vscode.workspace.getConfiguration()),
				},
			],
			(changes) => {
				const next = changes.get(LOCAL_JSONL_SETTING) as
					| LocalJsonlConfig
					| undefined;
				if (next) {
					sink.#config = next;
				}
			},
		);
		sink.#scheduleNextFlush();
		void sink.#cleanupOldFiles();
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
	 * one more is queued, and further callers share that queued promise.
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
		this.#configWatcher?.dispose();
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}
		await this.flush();
	}

	// Chained on completion (not setInterval) so flushes never overlap or pile up.
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
		const seg = next.segment > 0 ? `.${next.segment}` : "";
		const target = path.join(
			this.#baseDir,
			`${FILE_PREFIX}${next.date}-${this.#sessionSlug}${seg}${FILE_SUFFIX}`,
		);
		try {
			await fs.appendFile(target, payload, "utf8");
			this.#current = { ...next, size: next.size + payload.length };
			this.#overflowWarned = false;
		} catch (err) {
			// Leave #current and #overflowWarned alone: the next flush re-evaluates
			// rotation, and the warn flag fires again on the next overflow burst.
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

	async #cleanupOldFiles(): Promise<void> {
		try {
			await fs.mkdir(this.#baseDir, { recursive: true });
		} catch (err) {
			this.#logger.warn(
				`Telemetry sink '${this.name}' could not create base dir`,
				err,
			);
			return;
		}
		const maxAgeMs = this.#config.maxAgeDays * MS_PER_DAY;
		const { maxTotalBytes } = this.#config;
		await cleanupFiles(this.#baseDir, this.#logger, {
			fileType: "telemetry file",
			match: (name) =>
				name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX),
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
