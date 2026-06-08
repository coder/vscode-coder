import { Zip, ZipDeflate } from "fflate";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
	isAbortError,
	throwIfAborted,
	toError,
	wrapError,
} from "../../../../error/errorUtils";
import { writeAtomically } from "../../../../util/fs";
import { describeMetricEvent } from "../../metrics";

import { openEnvelopeFile, type EnvelopeFile } from "./envelope";
import { buildManifest, MANIFEST_FILE, type RecordCounts } from "./manifest";
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
import type { ExportDescriptor, ExportWriteOptions } from "../types";

/** Event totals by signal; a metric event with all records suppressed still counts as one. */
export interface OtlpExportCounts {
	readonly logs: number;
	readonly traces: number;
	readonly metrics: number;
}

/** OTLP/JSON format tag recorded in the manifest. */
const OTLP_FORMAT = "otlp-json";

interface Channel {
	file: EnvelopeFile;
	/** Source events routed to this signal. */
	count: number;
	/** OTLP records written to this signal. */
	records: number;
}

// Read high-water mark (HWM): bytes buffered per read while streaming a staged
// envelope into the zip.
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
	descriptor: ExportDescriptor,
	options: ExportWriteOptions = {},
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
					descriptor,
				);
				await packZip(zipPath, stagingDir, options.signal);
			} catch (err) {
				await safeRemove(stagingDir, options.onCleanupError);
				throw err;
			}
			await safeRemove(stagingDir, options.onCleanupError);
			return counts;
		},
		options.onCleanupError,
	);
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
	descriptor: ExportDescriptor,
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

	const counts: OtlpExportCounts = {
		logs: channels.logs.count,
		traces: channels.traces.count,
		metrics: channels.metrics.count,
	};
	await writeManifest(dir, descriptor, context, channels);
	return counts;
}

async function writeManifest(
	dir: string,
	descriptor: ExportDescriptor,
	context: TelemetryContext,
	channels: Record<Signal, Channel>,
): Promise<void> {
	const records: RecordCounts = {
		logs: channels.logs.records,
		traces: channels.traces.records,
		metrics: channels.metrics.records,
	};
	const sourceEvents =
		channels.logs.count + channels.traces.count + channels.metrics.count;
	const manifest = buildManifest({
		format: OTLP_FORMAT,
		input: descriptor,
		context,
		sourceEvents,
		records,
	});
	await fs.writeFile(
		path.join(dir, MANIFEST_FILE),
		JSON.stringify(manifest, null, 2),
		"utf8",
	);
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
		return { file, count: 0, records: 0 };
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

/**
 * A completed timed span (`trace()` / `Span.phase()`) always carries a
 * framework-set `result` property. Span-attached logs (`Span.log()` /
 * `Span.logError()`) share the `traceId` but have no `result`, so they route
 * to log records instead of becoming zero-duration spans.
 */
function isTimedSpan(
	event: TelemetryEvent,
): event is TelemetryEvent & { readonly traceId: string } {
	return (
		event.traceId !== undefined && Object.hasOwn(event.properties, "result")
	);
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
		} else if (isTimedSpan(event)) {
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
		channel.records += 1;
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
	const names = [
		...Object.values(ENVELOPES).map((envelope) => envelope.file),
		MANIFEST_FILE,
	];
	for (const name of names) {
		throwIfAborted(signal);
		await streamFileIntoZip(
			zip,
			name,
			path.join(sourceDir, name),
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
