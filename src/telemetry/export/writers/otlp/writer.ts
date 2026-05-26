import { Zip, ZipDeflate } from "fflate";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { isAbortError, toError, wrapError } from "../../../../error/errorUtils";
import { writeAtomically } from "../../../../util/fs";
import { describeMetricEvent } from "../../metrics";

import { openEnvelopeFile, type EnvelopeFile } from "./envelope";
import {
	ENVELOPES,
	ENVELOPE_SUFFIX,
	type CumulativeState,
	envelopePrefix,
	logRecord,
	metricRecords,
	newCumulativeState,
	otlpResource,
	otlpScope,
	type Signal,
	spanRecord,
} from "./records";

import type { TelemetryContext, TelemetryEvent } from "../../../event";

/** Event totals by signal — a metric event with all records suppressed still counts as one. */
export interface OtlpExportCounts {
	readonly logs: number;
	readonly traces: number;
	readonly metrics: number;
}

export interface OtlpWriteOptions {
	readonly signal?: AbortSignal;
	readonly onTempCleanupError?: (err: unknown, tempPath: string) => void;
	/** Fires on either success or failure path so cleanup errors never mask the export outcome. */
	readonly onStagingCleanupError?: (err: unknown, dir: string) => void;
}

interface Channel {
	file: EnvelopeFile;
	count: number;
}

const READ_HWM_BYTES = 256 * 1024;

/**
 * Writes `events` as an OTLP/JSON zip (`logs.json`, `traces.json`,
 * `metrics.json`) to `outputPath`. Staging happens in the OS temp dir so
 * cloud-sync agents on the user's chosen save location never see the
 * intermediate uncompressed envelopes.
 */
export async function writeOtlpZipExport(
	outputPath: string,
	events: AsyncIterable<TelemetryEvent>,
	context: TelemetryContext,
	options: OtlpWriteOptions = {},
): Promise<OtlpExportCounts> {
	throwIfAborted(options.signal);
	return writeAtomically(
		outputPath,
		async (zipPath) => {
			const stagingDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "coder-telemetry-otlp-"),
			);
			let counts: OtlpExportCounts;
			try {
				counts = await writeStagedFiles(
					stagingDir,
					events,
					context,
					options.signal,
				);
				await packZip(zipPath, stagingDir, options.signal);
			} catch (err) {
				await safeRemove(stagingDir, options.onStagingCleanupError);
				throw err;
			}
			await safeRemove(stagingDir, options.onStagingCleanupError);
			return counts;
		},
		options.onTempCleanupError ?? swallowCleanupError,
	);
}

function swallowCleanupError(): void {
	/* Default: temp-cleanup errors from writeAtomically are silently dropped. */
}

async function safeRemove(
	dir: string,
	onError?: (err: unknown, dir: string) => void,
): Promise<void> {
	try {
		await fs.rm(dir, { recursive: true, force: true });
	} catch (err) {
		try {
			onError?.(err, dir);
		} catch {
			// Swallow callback throws so they don't displace the export error.
		}
	}
}

async function writeStagedFiles(
	dir: string,
	events: AsyncIterable<TelemetryEvent>,
	context: TelemetryContext,
	signal: AbortSignal | undefined,
): Promise<OtlpExportCounts> {
	const resource = JSON.stringify(otlpResource(context));
	const scope = JSON.stringify(otlpScope(context.extensionVersion));
	const channels = await openChannels(dir, resource, scope);
	const state = newCumulativeState();

	let succeeded = false;
	try {
		for await (const event of events) {
			throwIfAborted(signal);
			await routeEvent(event, channels, state);
		}
		succeeded = true;
	} finally {
		// On success surface close failures; on failure swallow them so the
		// loop error isn't masked.
		const closes = Object.values(channels).map((c) => c.file.close());
		await (succeeded ? Promise.all(closes) : Promise.allSettled(closes));
	}

	return {
		logs: channels.logs.count,
		traces: channels.traces.count,
		metrics: channels.metrics.count,
	};
}

async function openChannels(
	dir: string,
	resource: string,
	scope: string,
): Promise<Record<Signal, Channel>> {
	const open = async (signal: Signal): Promise<Channel> => {
		const envelope = ENVELOPES[signal];
		const file = await openEnvelopeFile(
			path.join(dir, envelope.file),
			envelopePrefix(envelope, resource, scope),
			ENVELOPE_SUFFIX,
		);
		return { file, count: 0 };
	};
	// Promise.allSettled so one failure doesn't orphan its siblings' fds.
	const settled = await Promise.allSettled([
		open("logs"),
		open("traces"),
		open("metrics"),
	]);
	const failure = settled.find((r) => r.status === "rejected");
	if (failure) {
		await Promise.allSettled(
			settled.flatMap((r) =>
				r.status === "fulfilled" ? [r.value.file.close()] : [],
			),
		);
		throw failure.reason;
	}
	const [logs, traces, metrics] = settled.map(
		(r) => (r as PromiseFulfilledResult<Channel>).value,
	);
	return { logs, traces, metrics };
}

function hasTraceId(
	event: TelemetryEvent,
): event is TelemetryEvent & { readonly traceId: string } {
	return event.traceId !== undefined;
}

async function routeEvent(
	event: TelemetryEvent,
	channels: Record<Signal, Channel>,
	state: CumulativeState,
): Promise<void> {
	try {
		const metric = describeMetricEvent(event);
		if (metric) {
			await appendRecords(
				channels.metrics,
				metricRecords(event, metric, state),
			);
			channels.metrics.count += 1;
		} else if (hasTraceId(event)) {
			await appendRecords(channels.traces, [spanRecord(event)]);
			channels.traces.count += 1;
		} else {
			await appendRecords(channels.logs, [logRecord(event)]);
			channels.logs.count += 1;
		}
	} catch (err) {
		throw wrapError(
			"export event",
			`${event.eventId} (${event.eventName})`,
			err,
		);
	}
}

async function appendRecords(
	channel: Channel,
	records: Iterable<unknown>,
): Promise<void> {
	for (const record of records) {
		await channel.file.append(record);
	}
}

/** Streams the staged envelopes into a deflate-compressed zip; AbortError is rethrown unwrapped. */
async function packZip(
	outputPath: string,
	sourceDir: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	const outStream = createWriteStream(outputPath);
	try {
		await streamEnvelopesIntoZip(outStream, sourceDir, signal);
	} catch (err) {
		outStream.destroy();
		if (isAbortError(err)) {
			throw err;
		}
		throw wrapError("pack OTLP zip", path.basename(outputPath), err);
	}
}

/** Bridges fflate's Zip callback onto `outStream`; the pump awaits 'drain' on backpressure. */
function streamEnvelopesIntoZip(
	outStream: WriteStream,
	sourceDir: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const fail = (err: unknown): void => reject(toError(err));

		const waitForDrain = (): Promise<void> =>
			outStream.writableNeedDrain
				? new Promise<void>((r) => outStream.once("drain", r))
				: Promise.resolve();

		outStream.on("error", fail);

		const zip = new Zip((err, chunk, final) => {
			if (err) {
				fail(err);
				return;
			}
			if (final) {
				// end() waits for in-flight writes before 'finish'; no pendingWrites counter needed.
				outStream.end(chunk, () => resolve());
			} else {
				outStream.write(chunk, (writeErr) => {
					if (writeErr) {
						fail(writeErr);
					}
				});
			}
		});

		void pumpEnvelopes(zip, sourceDir, signal, waitForDrain).catch((err) => {
			zip.terminate();
			fail(err);
		});
	});
}

async function pumpEnvelopes(
	zip: Zip,
	sourceDir: string,
	signal: AbortSignal | undefined,
	waitForDrain: () => Promise<void>,
): Promise<void> {
	for (const envelope of Object.values(ENVELOPES)) {
		throwIfAborted(signal);
		await streamFileIntoZip(
			zip,
			envelope.file,
			path.join(sourceDir, envelope.file),
			signal,
			waitForDrain,
		);
	}
	zip.end();
}

async function streamFileIntoZip(
	zip: Zip,
	name: string,
	filePath: string,
	signal: AbortSignal | undefined,
	waitForDrain: () => Promise<void>,
): Promise<void> {
	const entry = new ZipDeflate(name);
	zip.add(entry);
	const readStream = createReadStream(filePath, {
		highWaterMark: READ_HWM_BYTES,
	});
	try {
		for await (const chunk of readStream) {
			throwIfAborted(signal);
			entry.push(chunk as Uint8Array, false);
			await waitForDrain();
		}
		entry.push(new Uint8Array(0), true);
	} finally {
		readStream.destroy();
	}
}

/** Like AbortSignal.throwIfAborted() but coerces non-Error reasons to a named AbortError. */
function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		const reason: unknown = signal.reason;
		throw reason instanceof Error
			? reason
			: Object.assign(new Error("Aborted"), { name: "AbortError" });
	}
}
