import { zip } from "fflate";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { toError } from "../../../../error/errorUtils";
import { writeAtomically } from "../../../../util/fs";
import { describeMetricEvent } from "../../metrics";

import { openEnvelopeFile, type EnvelopeFile } from "./envelope";
import {
	type ExportState,
	logRecord,
	metricRecords,
	newExportState,
	otlpResource,
	otlpScope,
	spanRecord,
} from "./records";

import type { TelemetryContext, TelemetryEvent } from "../../../event";

export interface OtlpExportCounts {
	readonly logs: number;
	readonly traces: number;
	readonly metrics: number;
}

interface Envelope {
	readonly file: string;
	readonly resourceKey: string;
	readonly scopeKey: string;
	readonly recordsKey: string;
}

const ENVELOPES = {
	logs: {
		file: "logs.json",
		resourceKey: "resourceLogs",
		scopeKey: "scopeLogs",
		recordsKey: "logRecords",
	},
	traces: {
		file: "traces.json",
		resourceKey: "resourceSpans",
		scopeKey: "scopeSpans",
		recordsKey: "spans",
	},
	metrics: {
		file: "metrics.json",
		resourceKey: "resourceMetrics",
		scopeKey: "scopeMetrics",
		recordsKey: "metrics",
	},
} as const satisfies Record<string, Envelope>;

const OTLP_SCHEMA_URL = "https://opentelemetry.io/schemas/1.24.0";
const ENVELOPE_SUFFIX = "]}]}]}\n";

const zipAsync = promisify(zip);

/**
 * Writes `events` as an OTLP/JSON zip (`logs.json`, `traces.json`,
 * `metrics.json`) to `outputPath`. Records stream into a staging directory
 * then get packed in-memory; the zip is atomically renamed at the end.
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
	const open = (e: Envelope) =>
		openEnvelopeFile(
			path.join(dir, e.file),
			envelopePrefix(e, resource, scope),
			ENVELOPE_SUFFIX,
		);
	const [logs, traces, metrics] = await Promise.all([
		open(ENVELOPES.logs),
		open(ENVELOPES.traces),
		open(ENVELOPES.metrics),
	]);
	const state = newExportState();
	const counts = { logs: 0, traces: 0, metrics: 0 };

	try {
		for await (const event of events) {
			await routeEvent(event, { logs, traces, metrics }, counts, state);
		}
		// Success path: surface close failures.
		await Promise.all([logs.close(), traces.close(), metrics.close()]);
	} catch (loopError) {
		// Failure path: close quietly so the original error isn't masked.
		await Promise.allSettled([logs.close(), traces.close(), metrics.close()]);
		throw loopError;
	}

	return counts;
}

async function routeEvent(
	event: TelemetryEvent,
	files: { logs: EnvelopeFile; traces: EnvelopeFile; metrics: EnvelopeFile },
	counts: { logs: number; traces: number; metrics: number },
	state: ExportState,
): Promise<void> {
	try {
		const metric = describeMetricEvent(event);
		if (metric) {
			counts.metrics += 1;
			for (const record of metricRecords(event, metric, state)) {
				await files.metrics.append(record);
			}
		} else if (event.traceId !== undefined) {
			counts.traces += 1;
			await files.traces.append(spanRecord(event));
		} else {
			counts.logs += 1;
			await files.logs.append(logRecord(event));
		}
	} catch (err) {
		throw new Error(
			`Failed to export event ${event.eventId} (${event.eventName}): ${toError(err).message}`,
			{ cause: err },
		);
	}
}

async function packZip(outputPath: string, sourceDir: string): Promise<void> {
	const files = await Promise.all(
		Object.values(ENVELOPES).map(async (e) => {
			try {
				return [
					e.file,
					await fs.readFile(path.join(sourceDir, e.file)),
				] as const;
			} catch (err) {
				throw new Error(
					`Failed to read staged ${e.file}: ${toError(err).message}`,
					{ cause: err },
				);
			}
		}),
	);
	try {
		await fs.writeFile(outputPath, await zipAsync(Object.fromEntries(files)));
	} catch (err) {
		throw new Error(
			`Failed to pack OTLP zip ${path.basename(outputPath)}: ${toError(err).message}`,
			{ cause: err },
		);
	}
}

function envelopePrefix(
	envelope: Envelope,
	resource: string,
	scope: string,
): string {
	return `{"${envelope.resourceKey}":[{"resource":${resource},"schemaUrl":"${OTLP_SCHEMA_URL}","${envelope.scopeKey}":[{"scope":${scope},"schemaUrl":"${OTLP_SCHEMA_URL}","${envelope.recordsKey}":[`;
}
