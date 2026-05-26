import { zip } from "fflate";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { wrapError } from "../../../../error/errorUtils";
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

export interface OtlpExportCounts {
	readonly logs: number;
	readonly traces: number;
	readonly metrics: number;
}

interface Channel {
	file: EnvelopeFile;
	count: number;
}

const zipAsync = promisify(zip);

/**
 * Writes `events` as an OTLP/JSON zip (`logs.json`, `traces.json`,
 * `metrics.json`) to `outputPath`.
 */
export async function writeOtlpZipExport(
	outputPath: string,
	events: AsyncIterable<TelemetryEvent>,
	context: TelemetryContext,
	onCleanupError: (err: unknown, tempPath: string) => void,
): Promise<OtlpExportCounts> {
	return writeAtomically(
		outputPath,
		async (zipPath) => {
			const stagingDir = await fs.mkdtemp(`${outputPath}.staging-`);
			try {
				const counts = await writeStagedFiles(stagingDir, events, context);
				await packZip(zipPath, stagingDir);
				return counts;
			} finally {
				await fs.rm(stagingDir, { recursive: true, force: true });
			}
		},
		onCleanupError,
	);
}

async function writeStagedFiles(
	dir: string,
	events: AsyncIterable<TelemetryEvent>,
	context: TelemetryContext,
): Promise<OtlpExportCounts> {
	const resource = JSON.stringify(otlpResource(context));
	const scope = JSON.stringify(otlpScope(context.extensionVersion));
	const channels = await openChannels(dir, resource, scope);
	const state = newCumulativeState();

	let succeeded = false;
	try {
		for await (const event of events) {
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
		} else if (hasTraceId(event)) {
			await appendRecords(channels.traces, [spanRecord(event)]);
		} else {
			await appendRecords(channels.logs, [logRecord(event)]);
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
	let wrote = false;
	for (const record of records) {
		await channel.file.append(record);
		wrote = true;
	}
	if (wrote) {
		channel.count += 1;
	}
}

async function packZip(outputPath: string, sourceDir: string): Promise<void> {
	try {
		const entries = await Promise.all(
			Object.values(ENVELOPES).map(
				async (envelope) =>
					[
						envelope.file,
						await fs.readFile(path.join(sourceDir, envelope.file)),
					] as const,
			),
		);
		await fs.writeFile(outputPath, await zipAsync(Object.fromEntries(entries)));
	} catch (err) {
		throw wrapError("pack OTLP zip", path.basename(outputPath), err);
	}
}
