import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { zip } from "fflate";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { writeAtomically } from "../../../util/fs";
import { parseTelemetryTimestampMs } from "../range";
import { classifyEvent, type ExportSignal } from "../signal";

import type { TelemetryContext, TelemetryEvent } from "../../event";

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { readonly [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;
type EventError = NonNullable<TelemetryEvent["error"]>;

export interface OtlpExportCounts {
	readonly logs: number;
	readonly traces: number;
	readonly metrics: number;
}

// OTLP proto SpanKind reserves 0 for UNSPECIFIED, so api values shift by 1
// on the wire. AGGREGATION_TEMPORALITY has no enum in @opentelemetry/api.
const otlpSpanKind = (kind: SpanKind): number => kind + 1;
const AGGREGATION_TEMPORALITY_CUMULATIVE = 2;
const OTLP_SCHEMA_URL = "https://opentelemetry.io/schemas/1.24.0";
const zipAsync = promisify(zip);

/**
 * Writes `events` as an OTLP/JSON zip (`logs.json`, `traces.json`,
 * `metrics.json`) to `outputPath`. Each file groups all records of one
 * signal under a single Resource block built from `context`. Events stream
 * into a sibling staging directory with backpressure; the directory is then
 * packed in-memory and the zip is atomically renamed onto `outputPath`.
 * `onCleanupError` is forwarded to `writeAtomically`.
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
				const counts = await writeOtlpJsonFiles(stagingDir, events, context);
				await packZip(
					zipPath,
					stagingDir,
					ENVELOPES.map((e) => e.file),
				);
				return counts;
			} finally {
				await fs.rm(stagingDir, { recursive: true, force: true });
			}
		},
		onCleanupError,
	);
}

/** Per-export state threaded through the metric mapper for cumulative sums. */
interface ExportState {
	readonly cumulative: {
		startTimeUnixNano: string | undefined;
		readonly totals: Map<string, bigint>;
	};
}

// Per-signal layout driving file names, envelope JSON keys, routing, and counts.
const ENVELOPES = [
	{
		signal: "log",
		counter: "logs",
		file: "logs.json",
		resourceKey: "resourceLogs",
		scopeKey: "scopeLogs",
		recordsKey: "logRecords",
		toRecords: (e: TelemetryEvent, _state: ExportState) => [toOtlpLogRecord(e)],
	},
	{
		signal: "trace",
		counter: "traces",
		file: "traces.json",
		resourceKey: "resourceSpans",
		scopeKey: "scopeSpans",
		recordsKey: "spans",
		toRecords: (e: TelemetryEvent, _state: ExportState) => [toOtlpSpan(e)],
	},
	{
		signal: "metric",
		counter: "metrics",
		file: "metrics.json",
		resourceKey: "resourceMetrics",
		scopeKey: "scopeMetrics",
		recordsKey: "metrics",
		toRecords: toOtlpMetricRecords,
	},
] as const satisfies ReadonlyArray<{
	signal: ExportSignal;
	counter: keyof OtlpExportCounts;
	file: string;
	resourceKey: string;
	scopeKey: string;
	recordsKey: string;
	toRecords: (event: TelemetryEvent, state: ExportState) => readonly unknown[];
}>;

async function writeOtlpJsonFiles(
	dir: string,
	events: AsyncIterable<TelemetryEvent>,
	context: TelemetryContext,
): Promise<OtlpExportCounts> {
	const resource = JSON.stringify(toOtlpResource(context));
	const scope = JSON.stringify(toOtlpScope(context.extensionVersion));
	const entries = await Promise.all(
		ENVELOPES.map(async (envelope) => ({
			...envelope,
			writer: await openEnvelope(
				path.join(dir, envelope.file),
				`{"${envelope.resourceKey}":[{"resource":${resource},"schemaUrl":"${OTLP_SCHEMA_URL}","${envelope.scopeKey}":[{"scope":${scope},"schemaUrl":"${OTLP_SCHEMA_URL}","${envelope.recordsKey}":[`,
				"]}]}]}\n",
			),
		})),
	);
	const state: ExportState = {
		cumulative: { startTimeUnixNano: undefined, totals: new Map() },
	};
	const counts: Record<keyof OtlpExportCounts, number> = {
		logs: 0,
		traces: 0,
		metrics: 0,
	};

	try {
		for await (const event of events) {
			const signal = classifyEvent(event);
			const entry = entries.find((e) => e.signal === signal);
			if (!entry) {
				continue;
			}
			counts[entry.counter] += 1;
			for (const record of entry.toRecords(event, state)) {
				await entry.writer.write(record);
			}
		}
	} finally {
		await Promise.all(entries.map((e) => e.writer.close()));
	}

	return counts;
}

interface EnvelopeWriter {
	write(value: unknown): Promise<void>;
	close(): Promise<void>;
}

/** Streams a `<prefix>v1,v2,...<suffix>` JSON envelope to disk. */
async function openEnvelope(
	filePath: string,
	prefix: string,
	suffix: string,
): Promise<EnvelopeWriter> {
	const stream = createWriteStream(filePath, { encoding: "utf8" });
	await writeChunk(stream, prefix);
	let written = 0;

	return {
		async write(value) {
			await writeChunk(
				stream,
				(written === 0 ? "" : ",") + JSON.stringify(value),
			);
			written += 1;
		},
		async close() {
			await writeChunk(stream, suffix);
			await new Promise<void>((resolve, reject) => {
				stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
			});
		},
	};
}

function writeChunk(
	stream: NodeJS.WritableStream,
	chunk: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		stream.write(chunk, "utf8", (err) => (err ? reject(err) : resolve()));
	});
}

async function packZip(
	outputPath: string,
	sourceDir: string,
	names: readonly string[],
): Promise<void> {
	const entries = await Promise.all(
		names.map(
			async (name) =>
				[name, await fs.readFile(path.join(sourceDir, name))] as const,
		),
	);
	const archive = await zipAsync(Object.fromEntries(entries));
	await fs.writeFile(outputPath, archive);
}

/** OTLP `Resource` block built once per export from the session context. */
function toOtlpResource(context: TelemetryContext): JsonObject {
	return {
		attributes: keyValues({
			"service.name": "coder-vscode-extension",
			"service.version": context.extensionVersion,
			"service.instance.id": context.sessionId,
			"host.id": context.machineId,
			"host.arch": context.hostArch,
			"os.type": context.osType,
			"os.version": context.osVersion,
			"vscode.platform.name": context.platformName,
			"vscode.platform.version": context.platformVersion,
			"coder.deployment.url": context.deploymentUrl,
		}),
	};
}

/** OTLP `InstrumentationScope` shared by every record. */
function toOtlpScope(version: string): JsonObject {
	return { name: "coder.vscode-coder.telemetry.export", version };
}

function toOtlpLogRecord(event: TelemetryEvent): JsonObject {
	const timeUnixNano = toUnixNano(event.timestamp);
	const errored = event.error !== undefined;
	return {
		timeUnixNano,
		observedTimeUnixNano: timeUnixNano,
		severityNumber: errored ? SeverityNumber.ERROR : SeverityNumber.INFO,
		severityText: errored ? "ERROR" : "INFO",
		body: { stringValue: event.eventName },
		attributes: keyValues({
			...event.properties,
			...event.measurements,
			...(event.error && exceptionAttributes(event.error)),
		}),
	};
}

function toOtlpSpan(event: TelemetryEvent): JsonObject {
	const endTimeUnixNano = toUnixNano(event.timestamp);
	const startTimeUnixNano = String(
		BigInt(endTimeUnixNano) - nanosFromMs(event.measurements.durationMs ?? 0),
	);

	return {
		traceId: event.traceId ?? "",
		spanId: event.eventId,
		...(event.parentEventId !== undefined && {
			parentSpanId: event.parentEventId,
		}),
		name: event.eventName,
		kind: otlpSpanKind(SpanKind.INTERNAL),
		startTimeUnixNano,
		endTimeUnixNano,
		attributes: keyValues({
			"coder.event_name": event.eventName,
			...event.properties,
			...withoutKey(event.measurements, "durationMs"),
		}),
		status: spanStatus(event),
		...(event.error && {
			events: [
				{
					name: "exception",
					timeUnixNano: endTimeUnixNano,
					attributes: keyValues(exceptionAttributes(event.error)),
				},
			],
		}),
	};
}

function spanStatus(event: TelemetryEvent): JsonObject {
	if (event.properties.result === "success") {
		return { code: SpanStatusCode.OK };
	}
	if (event.properties.result === "error" || event.error !== undefined) {
		return {
			code: SpanStatusCode.ERROR,
			...(event.error && { message: event.error.message }),
		};
	}
	return { code: SpanStatusCode.UNSET };
}

/** A metric event yields one record per measurement (http.requests fans out). */
function toOtlpMetricRecords(
	event: TelemetryEvent,
	state: ExportState,
): JsonObject[] {
	const timeUnixNano = toUnixNano(event.timestamp);
	const attributes = metricAttributes(event);
	if (event.eventName === "http.requests") {
		return toHttpRequestMetrics(event, timeUnixNano, attributes, state);
	}
	return toGaugeMetrics(
		event,
		Object.entries(event.measurements),
		attributes,
		timeUnixNano,
	);
}

function toHttpRequestMetrics(
	event: TelemetryEvent,
	timeUnixNano: string,
	attributes: JsonObject[],
	state: ExportState,
): JsonObject[] {
	const counts: Array<[string, number]> = [];
	const gauges: Array<[string, number]> = [];
	let windowSeconds: number | undefined;
	for (const [name, value] of Object.entries(event.measurements)) {
		if (name === "window_seconds") {
			windowSeconds = value;
		} else if (name.startsWith("count_")) {
			counts.push([name, value]);
		} else {
			gauges.push([name, value]);
		}
	}
	const windowStartUnixNano = String(
		BigInt(timeUnixNano) - nanosFromSeconds(windowSeconds ?? 0),
	);
	// Cumulative series anchor: first observed window's start, stable across
	// every subsequent http.requests data point in this export.
	state.cumulative.startTimeUnixNano ??= windowStartUnixNano;
	const cumulativeStart = state.cumulative.startTimeUnixNano;

	const sumRecords: JsonObject[] = [];
	for (const [name, value] of counts) {
		const seriesKey = `${name}|${stableSeriesKey(event.properties)}`;
		const total =
			(state.cumulative.totals.get(seriesKey) ?? 0n) +
			BigInt(Math.trunc(value));
		state.cumulative.totals.set(seriesKey, total);
		// Suppress unchanged-from-zero counters to save bytes; receivers
		// interpret an absent series as "no events yet".
		if (total === 0n) {
			continue;
		}
		sumRecords.push({
			name: `${event.eventName}.${name}`,
			description: event.eventName,
			unit: "{request}",
			sum: {
				aggregationTemporality: AGGREGATION_TEMPORALITY_CUMULATIVE,
				isMonotonic: true,
				dataPoints: [
					{
						attributes,
						startTimeUnixNano: cumulativeStart,
						timeUnixNano,
						asInt: String(total),
					},
				],
			},
		});
	}

	return [
		...sumRecords,
		...toGaugeMetrics(
			event,
			gauges,
			attributes,
			timeUnixNano,
			windowStartUnixNano,
		),
	];
}

function stableSeriesKey(properties: Readonly<Record<string, string>>): string {
	return Object.entries(properties)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}=${v}`)
		.join("|");
}

function toGaugeMetrics(
	event: TelemetryEvent,
	measurements: Array<[string, number]>,
	attributes: JsonObject[],
	timeUnixNano: string,
	startTimeUnixNano?: string,
): JsonObject[] {
	return measurements.map(([name, value]) => ({
		name: `${event.eventName}.${name}`,
		description: event.eventName,
		unit: metricUnit(name),
		gauge: {
			dataPoints: [
				{
					attributes,
					...(startTimeUnixNano !== undefined && { startTimeUnixNano }),
					timeUnixNano,
					asDouble: value,
				},
			],
		},
	}));
}

function metricAttributes(event: TelemetryEvent): JsonObject[] {
	return keyValues({
		"coder.event_name": event.eventName,
		...event.properties,
	});
}

function metricUnit(measurementName: string): string {
	if (measurementName.endsWith("_ms") || measurementName.endsWith("Ms")) {
		return "ms";
	}
	if (measurementName.endsWith("Mbits")) {
		return "Mbit/s";
	}
	return "1";
}

function exceptionAttributes(error: EventError): Record<string, string> {
	return {
		"exception.message": error.message,
		...(error.type !== undefined && { "exception.type": error.type }),
		...(error.code !== undefined && { "exception.code": error.code }),
	};
}

function keyValues(
	values: Readonly<Record<string, string | number>>,
): JsonObject[] {
	return Object.entries(values).map(([key, value]) => {
		const otlpValue: JsonObject =
			typeof value === "number"
				? { doubleValue: value }
				: { stringValue: value };
		return { key, value: otlpValue };
	});
}

function withoutKey<T>(
	values: Readonly<Record<string, T>>,
	excluded: string,
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(values).filter(([name]) => name !== excluded),
	);
}

function toUnixNano(timestamp: string): string {
	return String(BigInt(parseTelemetryTimestampMs(timestamp)) * 1_000_000n);
}

function nanosFromMs(ms: number): bigint {
	return BigInt(Math.max(0, Math.round(ms * 1e6)));
}

function nanosFromSeconds(seconds: number): bigint {
	return BigInt(Math.max(0, Math.round(seconds * 1e9)));
}
