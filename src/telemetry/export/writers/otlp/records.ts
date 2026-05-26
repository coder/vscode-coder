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

export type Signal = "logs" | "traces" | "metrics";

export interface EnvelopeSpec {
	readonly file: string;
	readonly resourceKey: string;
	readonly scopeKey: string;
	readonly recordsKey: string;
}

export const ENVELOPES = {
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
} as const satisfies Record<Signal, EnvelopeSpec>;

const OTLP_SCHEMA_URL = "https://opentelemetry.io/schemas/1.24.0";
export const ENVELOPE_SUFFIX = "]}]}]}\n";

const AGGREGATION_TEMPORALITY_CUMULATIVE = 2;
// OTLP proto SpanKind reserves 0 for UNSPECIFIED; @opentelemetry/api values
// start at 0 (INTERNAL), so shift by 1 when encoding for proto.
const OTLP_SPAN_KIND_OFFSET = 1;

export function envelopePrefix(
	envelope: EnvelopeSpec,
	resource: string,
	scope: string,
): string {
	return `{"${envelope.resourceKey}":[{"resource":${resource},"schemaUrl":"${OTLP_SCHEMA_URL}","${envelope.scopeKey}":[{"scope":${scope},"schemaUrl":"${OTLP_SCHEMA_URL}","${envelope.recordsKey}":[`;
}

export interface CumulativeState {
	anchor: bigint | undefined;
	readonly totals: Map<string, bigint>;
}

export function newCumulativeState(): CumulativeState {
	return { anchor: undefined, totals: new Map() };
}

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

export function otlpScope(version: string) {
	return { name: "coder.vscode-coder.telemetry.export", version };
}

export function logRecord(event: TelemetryEvent): OtlpLogRecord {
	const timeUnixNano = String(toUnixNano(event.timestamp));
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

export function spanRecord(
	event: TelemetryEvent & { readonly traceId: string },
): OtlpSpan {
	const endNano = toUnixNano(event.timestamp);
	const startNano = endNano - nanosFromMs(event.measurements.durationMs ?? 0);
	const endTimeUnixNano = String(endNano);
	const { durationMs: _, ...measurements } = event.measurements;
	return {
		traceId: event.traceId,
		spanId: event.eventId,
		...(event.parentEventId !== undefined && {
			parentSpanId: event.parentEventId,
		}),
		name: event.eventName,
		kind: SpanKind.INTERNAL + OTLP_SPAN_KIND_OFFSET,
		startTimeUnixNano: String(startNano),
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
	switch (event.properties.result) {
		case "success":
			return { code: SpanStatusCode.OK };
		case "error":
			return {
				code: SpanStatusCode.ERROR,
				...(event.error && { message: event.error.message }),
			};
	}
	if (event.error !== undefined) {
		return { code: SpanStatusCode.ERROR, message: event.error.message };
	}
	return { code: SpanStatusCode.UNSET };
}

interface MetricContext {
	readonly eventName: string;
	readonly properties: Readonly<Record<string, string>>;
	readonly attributes: readonly OtlpKeyValue[];
	readonly timeNano: bigint;
	readonly windowStartNano: bigint | undefined;
}

/** OTLP metric records (gauges and cumulative sums) for one metric event. */
export function metricRecords(
	event: TelemetryEvent,
	descriptor: MetricDescriptor,
	state: CumulativeState,
): OtlpMetric[] {
	const timeNano = toUnixNano(event.timestamp);
	const windowStartNano =
		descriptor.windowSeconds !== undefined
			? timeNano - nanosFromSeconds(descriptor.windowSeconds)
			: undefined;
	// Anchor cumulative series on the first event seen; reused across the export.
	state.anchor ??= windowStartNano ?? timeNano;

	const ctx: MetricContext = {
		eventName: event.eventName,
		properties: event.properties,
		attributes: keyValues({
			"coder.event_name": event.eventName,
			...event.properties,
		}),
		timeNano,
		windowStartNano,
	};

	return descriptor.measurements.flatMap((m) => {
		const record =
			m.kind === "counter" ? sumMetric(ctx, m, state) : gaugeMetric(ctx, m);
		return record ? [record] : [];
	});
}

function gaugeMetric(ctx: MetricContext, m: MetricMeasurement): OtlpMetric {
	return {
		name: `${ctx.eventName}.${m.name}`,
		description: ctx.eventName,
		unit: m.unit,
		gauge: {
			dataPoints: [
				{
					attributes: ctx.attributes,
					...(ctx.windowStartNano !== undefined && {
						startTimeUnixNano: String(ctx.windowStartNano),
					}),
					timeUnixNano: String(ctx.timeNano),
					asDouble: m.value,
				},
			],
		},
	};
}

function sumMetric(
	ctx: MetricContext,
	m: MetricMeasurement,
	state: CumulativeState,
): OtlpMetric | undefined {
	// Clamp the anchor so out-of-order events can't emit startTime > timeUnixNano.
	const anchor = state.anchor ?? ctx.timeNano;
	const startNano = anchor <= ctx.timeNano ? anchor : ctx.timeNano;
	const sortedProps = Object.fromEntries(
		Object.entries(ctx.properties).sort(([a], [b]) => a.localeCompare(b)),
	);
	// JSON.stringify avoids collisions like `{a: "b|c=d"}` vs `{a: "b", c: "d"}`.
	const key = `${ctx.eventName}\x00${m.name}\x00${JSON.stringify(sortedProps)}`;
	// Clamp negatives: backends treat a decreasing monotonic sum as a reset.
	const delta = toIntegerBigInt(Math.max(0, m.value));
	const total = (state.totals.get(key) ?? 0n) + delta;
	state.totals.set(key, total);
	// Suppress zero counters; absence reads as "no events".
	if (total === 0n) {
		return undefined;
	}
	return {
		name: `${ctx.eventName}.${m.name}`,
		description: ctx.eventName,
		unit: m.unit,
		sum: {
			aggregationTemporality: AGGREGATION_TEMPORALITY_CUMULATIVE,
			isMonotonic: true,
			dataPoints: [
				{
					attributes: ctx.attributes,
					startTimeUnixNano: String(startNano),
					timeUnixNano: String(ctx.timeNano),
					asInt: String(total),
				},
			],
		},
	};
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

function toUnixNano(timestamp: string): bigint {
	return BigInt(parseTelemetryTimestampMs(timestamp)) * 1_000_000n;
}

function nanosFromMs(ms: number): bigint {
	return toNonNegativeBigInt(ms * 1e6);
}

function nanosFromSeconds(seconds: number): bigint {
	return toNonNegativeBigInt(seconds * 1e9);
}

function toIntegerBigInt(n: number): bigint {
	if (!Number.isFinite(n)) {
		return 0n;
	}
	return BigInt(Math.round(n));
}

function toNonNegativeBigInt(n: number): bigint {
	return n > 0 ? toIntegerBigInt(n) : 0n;
}
