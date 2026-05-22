import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";

import { type MetricDescriptor, type MetricMeasurement } from "../../metrics";
import { parseTelemetryTimestampMs } from "../../range";

import type { TelemetryContext, TelemetryEvent } from "../../../event";

import type {
	OtlpKeyValue,
	OtlpLogRecord,
	OtlpMetric,
	OtlpSpan,
	OtlpStatus,
} from "./types";

/** Per-export state for cumulative HTTP counters. */
export interface ExportState {
	cumulativeStart: string | undefined;
	readonly cumulativeTotals: Map<string, bigint>;
}

export function newExportState(): ExportState {
	return { cumulativeStart: undefined, cumulativeTotals: new Map() };
}

/** OTLP `Resource`, one per export. */
export function otlpResource(context: TelemetryContext) {
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

/** OTLP `InstrumentationScope`, shared by every record. */
export function otlpScope(version: string) {
	return { name: "coder.vscode-coder.telemetry.export", version };
}

export function logRecord(event: TelemetryEvent): OtlpLogRecord {
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

export function spanRecord(event: TelemetryEvent): OtlpSpan {
	const endTimeUnixNano = toUnixNano(event.timestamp);
	const startTimeUnixNano = String(
		BigInt(endTimeUnixNano) - nanosFromMs(event.measurements.durationMs ?? 0),
	);
	// durationMs is encoded as start/end times; don't repeat it as an attribute.
	const { durationMs: _durationMs, ...measurements } = event.measurements;
	return {
		traceId: event.traceId ?? "",
		spanId: event.eventId,
		...(event.parentEventId !== undefined && {
			parentSpanId: event.parentEventId,
		}),
		name: event.eventName,
		// OTLP proto SpanKind reserves 0 for UNSPECIFIED; api values shift by 1.
		kind: SpanKind.INTERNAL + 1,
		startTimeUnixNano,
		endTimeUnixNano,
		attributes: keyValues({
			"coder.event_name": event.eventName,
			...event.properties,
			...measurements,
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

function spanStatus(event: TelemetryEvent): OtlpStatus {
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

/** Gauge and cumulative-sum records for one classified metric event. */
export function metricRecords(
	event: TelemetryEvent,
	descriptor: MetricDescriptor,
	state: ExportState,
): OtlpMetric[] {
	const timeUnixNano = toUnixNano(event.timestamp);
	const attributes = keyValues({
		"coder.event_name": event.eventName,
		...event.properties,
	});
	const windowStart =
		descriptor.windowSeconds !== undefined
			? String(
					BigInt(timeUnixNano) - nanosFromSeconds(descriptor.windowSeconds),
				)
			: undefined;
	// Anchor cumulative series on the first event seen; reused across the export.
	state.cumulativeStart ??= windowStart ?? timeUnixNano;

	const records: OtlpMetric[] = [];
	for (const m of descriptor.measurements) {
		if (m.kind === "counter") {
			const sum = cumulativeSum(event, m, attributes, timeUnixNano, state);
			if (sum) {
				records.push(sum);
			}
		} else {
			records.push(
				gaugeRecord(event.eventName, m, attributes, timeUnixNano, windowStart),
			);
		}
	}
	return records;
}

function gaugeRecord(
	eventName: string,
	measurement: MetricMeasurement,
	attributes: readonly OtlpKeyValue[],
	timeUnixNano: string,
	startTimeUnixNano?: string,
): OtlpMetric {
	return {
		name: `${eventName}.${measurement.name}`,
		description: eventName,
		unit: measurement.unit,
		gauge: {
			dataPoints: [
				{
					attributes,
					...(startTimeUnixNano !== undefined && { startTimeUnixNano }),
					timeUnixNano,
					asDouble: measurement.value,
				},
			],
		},
	};
}

// No enum in @opentelemetry/api; 2 == CUMULATIVE.
const AGGREGATION_TEMPORALITY_CUMULATIVE = 2;

function cumulativeSum(
	event: TelemetryEvent,
	measurement: MetricMeasurement,
	attributes: readonly OtlpKeyValue[],
	timeUnixNano: string,
	state: ExportState,
): OtlpMetric | undefined {
	// Clamp the anchor so out-of-order events can't emit startTime > timeTime.
	const anchor = state.cumulativeStart ?? timeUnixNano;
	const startTimeUnixNano =
		BigInt(anchor) <= BigInt(timeUnixNano) ? anchor : timeUnixNano;
	const key = `${event.eventName}|${measurement.name}|${seriesKey(event.properties)}`;
	const total =
		(state.cumulativeTotals.get(key) ?? 0n) +
		toIntegerBigInt(measurement.value);
	state.cumulativeTotals.set(key, total);
	// Suppress zero counters; absence reads as "no events".
	if (total === 0n) {
		return undefined;
	}
	return {
		name: `${event.eventName}.${measurement.name}`,
		description: event.eventName,
		unit: measurement.unit,
		sum: {
			aggregationTemporality: AGGREGATION_TEMPORALITY_CUMULATIVE,
			isMonotonic: true,
			dataPoints: [
				{ attributes, startTimeUnixNano, timeUnixNano, asInt: String(total) },
			],
		},
	};
}

/** Stable key for property labels so identical labels share a series. */
function seriesKey(properties: Readonly<Record<string, string>>): string {
	return Object.entries(properties)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}=${v}`)
		.join("|");
}

function exceptionAttributes(
	error: NonNullable<TelemetryEvent["error"]>,
): Record<string, string> {
	return {
		"exception.message": error.message,
		...(error.type !== undefined && { "exception.type": error.type }),
		...(error.code !== undefined && { "exception.code": error.code }),
	};
}

function keyValues(
	values: Readonly<Record<string, string | number>>,
): OtlpKeyValue[] {
	return Object.entries(values).map(([key, value]) => ({
		key,
		value:
			typeof value === "number"
				? { doubleValue: value }
				: { stringValue: value },
	}));
}

function toUnixNano(timestamp: string): string {
	return String(BigInt(parseTelemetryTimestampMs(timestamp)) * 1_000_000n);
}

function nanosFromMs(ms: number): bigint {
	return toNonNegativeBigInt(ms * 1e6);
}

function nanosFromSeconds(seconds: number): bigint {
	return toNonNegativeBigInt(seconds * 1e9);
}

// Coerce non-finite/negative to 0n; round the rest.
function toNonNegativeBigInt(n: number): bigint {
	if (!Number.isFinite(n) || n <= 0) {
		return 0n;
	}
	return BigInt(Math.round(n));
}

// Counter increments must be integers; coerce NaN/Infinity to 0n.
function toIntegerBigInt(n: number): bigint {
	if (!Number.isFinite(n)) {
		return 0n;
	}
	return BigInt(Math.round(n));
}
