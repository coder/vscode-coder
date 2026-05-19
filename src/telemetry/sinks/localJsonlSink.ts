import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { watchConfigurationChanges } from "../../configWatcher";
import {
	LOCAL_TELEMETRY_SETTING,
	readLocalSinkConfig,
	type LocalSinkConfig,
} from "../../settings/telemetry";
import {
	cleanupFiles,
	type FileCleanupCandidate,
} from "../../util/fileCleanup";
import { serializeTelemetryEvent } from "../wireFormat";

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
 * `dispose` and catches errors. Tunables come from `coder.telemetry.local`
 * and update reactively.
 */
export class LocalJsonlSink implements TelemetrySink, vscode.Disposable {
	public readonly name = SINK_NAME;
	public readonly minLevel: TelemetryLevel = "local";

	readonly #baseDir: string;
	readonly #sessionSlug: string;
	readonly #logger: Logger;
	readonly #buffer: string[] = [];
	#config: LocalSinkConfig;
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
		config: LocalSinkConfig,
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
		const config = readLocalSinkConfig(vscode.workspace.getConfiguration());
		warnIfBufferTooSmall(config, logger);
		const sink = new LocalJsonlSink(opts, logger, config);
		sink.#configWatcher = sink.#watchConfig();
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
		this.#enforceBufferLimit();
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
		const run = async (): Promise<void> => {
			this.#hasQueued = false;
			await this.#doFlush();
		};
		this.#flushChain = this.#flushChain.then(run, run);
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

	#enforceBufferLimit(): void {
		const overage = this.#buffer.length - this.#config.bufferLimit;
		if (overage <= 0) {
			return;
		}
		this.#buffer.splice(0, overage);
		if (!this.#overflowWarned) {
			this.#overflowWarned = true;
			this.#logger.warn(
				`Telemetry sink '${this.name}' buffer overflow: dropped ${overage} oldest event(s)`,
			);
		}
	}

	#watchConfig(): vscode.Disposable {
		return watchConfigurationChanges(
			[
				{
					setting: LOCAL_TELEMETRY_SETTING,
					getValue: () =>
						readLocalSinkConfig(vscode.workspace.getConfiguration()),
				},
			],
			(changes) => {
				const next = changes.get(LOCAL_TELEMETRY_SETTING) as
					| LocalSinkConfig
					| undefined;
				if (!next) {
					return;
				}
				warnIfBufferTooSmall(next, this.#logger);
				const intervalChanged =
					next.flushIntervalMs !== this.#config.flushIntervalMs;
				this.#config = next;
				if (intervalChanged) {
					this.#scheduleNextFlush();
				}
			},
		);
	}

	// Self-rescheduling timer so flushes can never overlap or pile up.
	#scheduleNextFlush(): void {
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}
		if (this.#disposed) {
			return;
		}
		this.#flushTimer = setTimeout(() => {
			void this.flush().finally(() => this.#scheduleNextFlush());
		}, this.#config.flushIntervalMs);
	}

	async #doFlush(): Promise<void> {
		if (this.#buffer.length === 0) {
			return;
		}
		// Capture before any await so concurrent writes go to the next batch.
		const lines = this.#buffer.splice(0);
		const payload = lines.join("");
		const payloadBytes = Buffer.byteLength(payload, "utf8");
		try {
			await this.#append(payload, payloadBytes);
			this.#overflowWarned = false;
		} catch (err) {
			// Reset so the next overflow burst is logged on repeated failures.
			this.#overflowWarned = false;
			this.#logger.warn(
				`Telemetry sink '${this.name}' flush failed, ${lines.length} event(s) discarded`,
				err,
			);
		}
	}

	async #append(payload: string, payloadBytes: number): Promise<void> {
		await fs.mkdir(this.#baseDir, { recursive: true });
		const next = await this.#nextFile(payloadBytes);
		await fs.appendFile(this.#segmentPath(next), payload, "utf8");
		this.#current = { ...next, size: next.size + payloadBytes };
	}

	async #nextFile(payloadSize: number): Promise<CurrentFile> {
		const today = todayUtc();
		const seeded =
			this.#current.date === today
				? this.#current
				: await this.#seedFromDisk(today);
		const wouldExceed = seeded.size + payloadSize > this.#config.maxFileBytes;
		if (seeded.size > 0 && wouldExceed) {
			return { date: today, segment: seeded.segment + 1, size: 0 };
		}
		return seeded;
	}

	/** Picks up bytes left in segment 0 by a prior Extension Host activation in the same VS Code session. */
	async #seedFromDisk(today: string): Promise<CurrentFile> {
		const target = this.#segmentPath({ date: today, segment: 0 });
		const size = await statBytes(target, this.#logger);
		return { date: today, segment: 0, size };
	}

	#segmentPath(file: { date: string; segment: number }): string {
		const seg = file.segment > 0 ? `.${file.segment}` : "";
		return path.join(
			this.#baseDir,
			`${FILE_PREFIX}${file.date}-${this.#sessionSlug}${seg}${FILE_SUFFIX}`,
		);
	}

	async #cleanupOldFiles(): Promise<void> {
		// Skip files this session is writing to: cleanup must not race with our own appends.
		const sessionMarker = `-${this.#sessionSlug}`;
		await cleanupFiles(this.#baseDir, this.#logger, {
			label: "telemetry file",
			filter: (name) =>
				name.startsWith(FILE_PREFIX) &&
				name.endsWith(FILE_SUFFIX) &&
				!name.includes(sessionMarker),
			select: selectByAgeAndSize(
				this.#config.maxAgeDays * MS_PER_DAY,
				this.#config.maxTotalBytes,
			),
		});
	}
}

function selectByAgeAndSize(maxAgeMs: number, maxTotalBytes: number) {
	return (
		files: FileCleanupCandidate[],
		now: number,
	): Array<{ name: string }> => {
		const toDelete: Array<{ name: string }> = [];
		const survivors: FileCleanupCandidate[] = [];
		let totalBytes = 0;
		for (const file of files) {
			if (now - file.mtime > maxAgeMs) {
				toDelete.push({ name: file.name });
			} else {
				survivors.push(file);
				totalBytes += file.size;
			}
		}
		survivors.sort((a, b) => a.mtime - b.mtime);
		for (const file of survivors) {
			if (totalBytes <= maxTotalBytes) {
				break;
			}
			toDelete.push({ name: file.name });
			totalBytes -= file.size;
		}
		return toDelete;
	};
}

async function statBytes(target: string, logger: Logger): Promise<number> {
	try {
		return (await fs.stat(target)).size;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			logger.debug(`stat ${target} failed; treating size as 0`, err);
		}
		return 0;
	}
}

function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

function warnIfBufferTooSmall(config: LocalSinkConfig, logger: Logger): void {
	if (config.bufferLimit < config.flushBatchSize) {
		logger.warn(
			`Telemetry sink '${SINK_NAME}' bufferLimit (${config.bufferLimit}) is below flushBatchSize (${config.flushBatchSize}); the batch-size flush trigger is unreachable and overflow will drop events instead. Raise bufferLimit or lower flushBatchSize.`,
		);
	}
}

function toSessionSlug(sessionId: string): string {
	const cleaned = sessionId.replace(/[^a-zA-Z0-9]/g, "");
	return cleaned.slice(0, 8) || "anon0000";
}

function serializeEvent(event: TelemetryEvent): string {
	return JSON.stringify(serializeTelemetryEvent(event)) + "\n";
}
