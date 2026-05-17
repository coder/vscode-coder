import type { TelemetryEvent } from "../event";

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { readonly [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;

const STATUS_CODE_UNSET = 0;
const STATUS_CODE_OK = 1;
const STATUS_CODE_ERROR = 2;
const SPAN_KIND_INTERNAL = 1;

const SEVERITY_NUMBER_INFO = 9;
const SEVERITY_NUMBER_ERROR = 17;

const AGGREGATION_TEMPORALITY_DELTA = 1;

const METRIC_EVENT_NAMES = new Set([
	"http.requests",
	"ssh.network.info",
	"ssh.network.sampled",
]);

export function isMetricEvent(event: TelemetryEvent): boolean {
	return METRIC_EVENT_NAMES.has(event.eventName);
}

export function toOtlpLogResource(event: TelemetryEvent): JsonObject {
	return {
		resource: { attributes: resourceAttributes(event) },
		scopeLogs: [
			{
				scope: instrumentationScope(),
				logRecords: [toLogRecord(event)],
			},
		],
	};
}

export function toOtlpSpanResource(event: TelemetryEvent): JsonObject {
	return {
		resource: { attributes: resourceAttributes(event) },
		scopeSpans: [
			{
				scope: instrumentationScope(),
				spans: [toSpan(event)],
			},
		],
	};
}

export function toOtlpMetricResource(event: TelemetryEvent): JsonObject {
	return {
		resource: { attributes: resourceAttributes(event) },
		scopeMetrics: [
			{
				scope: instrumentationScope(),
				metrics: toMetrics(event),
			},
		],
	};
}

function toLogRecord(event: TelemetryEvent): JsonObject {
	const timeUnixNano = toUnixNano(event.timestamp);
	return {
		timeUnixNano,
		observedTimeUnixNano: timeUnixNano,
		severityNumber:
			event.error === undefined ? SEVERITY_NUMBER_INFO : SEVERITY_NUMBER_ERROR,
		severityText: event.error === undefined ? "INFO" : "ERROR",
		body: { stringValue: event.eventName },
		attributes: eventAttributes(event),
	};
}

function toSpan(event: TelemetryEvent): JsonObject {
	const endTimeUnixNano = toUnixNano(event.timestamp);
	const startTimeUnixNano = toSpanStartUnixNano(event, endTimeUnixNano);
	return {
		traceId: event.traceId ?? "",
		spanId: event.eventId,
		...(event.parentEventId !== undefined && {
			parentSpanId: event.parentEventId,
		}),
		name: spanName(event.eventName),
		kind: SPAN_KIND_INTERNAL,
		startTimeUnixNano,
		endTimeUnixNano,
		attributes: spanAttributes(event),
		status: spanStatus(event),
		...(event.error !== undefined && {
			events: [exceptionSpanEvent(event, endTimeUnixNano)],
		}),
	};
}

function toMetrics(event: TelemetryEvent): JsonObject[] {
	if (event.eventName === "http.requests") {
		return toHttpRequestMetrics(event);
	}
	return toGaugeMetrics(event, Object.entries(event.measurements));
}

function toHttpRequestMetrics(event: TelemetryEvent): JsonObject[] {
	const windowSeconds = event.measurements.window_seconds;
	const measurements = Object.entries(event.measurements).filter(
		([name]) => name !== "window_seconds",
	);
	const countMetrics = measurements.filter(([name]) =>
		name.startsWith("count_"),
	);
	const gaugeMetrics = measurements.filter(
		([name]) => !name.startsWith("count_"),
	);
	const timeUnixNano = toUnixNano(event.timestamp);
	return [
		...countMetrics.map(([name, value]) =>
			toSumMetric(event, name, value, timeUnixNano, windowSeconds),
		),
		...toGaugeMetrics(event, gaugeMetrics, {
			startTimeUnixNano: windowStartUnixNano(timeUnixNano, windowSeconds),
			timeUnixNano,
		}),
	];
}

function toSumMetric(
	event: TelemetryEvent,
	measurementName: string,
	value: number,
	timeUnixNano: string,
	windowSeconds: number | undefined,
): JsonObject {
	return {
		name: `${event.eventName}.${measurementName}`,
		description: event.eventName,
		unit: "{request}",
		sum: {
			aggregationTemporality: AGGREGATION_TEMPORALITY_DELTA,
			isMonotonic: true,
			dataPoints: [
				{
					attributes: metricAttributes(event),
					startTimeUnixNano: windowStartUnixNano(timeUnixNano, windowSeconds),
					timeUnixNano,
					asInt: String(Math.trunc(value)),
				},
			],
		},
	};
}

function toGaugeMetrics(
	event: TelemetryEvent,
	measurements: Array<[string, number]>,
	times: {
		readonly startTimeUnixNano?: string;
		readonly timeUnixNano: string;
	} = {
		timeUnixNano: toUnixNano(event.timestamp),
	},
): JsonObject[] {
	return measurements.map(([name, value]) => ({
		name: `${event.eventName}.${name}`,
		description: event.eventName,
		unit: metricUnit(name),
		gauge: {
			dataPoints: [
				{
					attributes: metricAttributes(event),
					...(times.startTimeUnixNano !== undefined && {
						startTimeUnixNano: times.startTimeUnixNano,
					}),
					timeUnixNano: times.timeUnixNano,
					asDouble: value,
				},
			],
		},
	}));
}

function resourceAttributes(event: TelemetryEvent): JsonObject[] {
	return keyValues({
		"service.name": "coder-vscode-extension",
		"service.version": event.context.extensionVersion,
		"coder.machine.id": event.context.machineId,
		"coder.session.id": event.context.sessionId,
		"os.type": event.context.osType,
		"os.version": event.context.osVersion,
		"host.arch": event.context.hostArch,
		"vscode.platform.name": event.context.platformName,
		"vscode.platform.version": event.context.platformVersion,
		"coder.deployment.url": event.context.deploymentUrl,
	});
}

function eventAttributes(event: TelemetryEvent): JsonObject[] {
	return keyValues({
		...event.properties,
		...event.measurements,
		...(event.error !== undefined && {
			"exception.message": event.error.message,
			...(event.error.type !== undefined && {
				"exception.type": event.error.type,
			}),
			...(event.error.code !== undefined && {
				"exception.code": event.error.code,
			}),
		}),
	});
}

function spanAttributes(event: TelemetryEvent): JsonObject[] {
	return keyValues({
		"coder.event_name": event.eventName,
		...event.properties,
		...Object.fromEntries(
			Object.entries(event.measurements).filter(
				([name]) => name !== "durationMs",
			),
		),
	});
}

function metricAttributes(event: TelemetryEvent): JsonObject[] {
	return keyValues({
		"coder.event_name": event.eventName,
		...event.properties,
	});
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

function instrumentationScope(): JsonObject {
	return {
		name: "coder.vscode-coder.telemetry.export",
	};
}

function spanStatus(event: TelemetryEvent): JsonObject {
	if (event.properties.result === "success") {
		return { code: STATUS_CODE_OK };
	}
	if (event.properties.result === "error" || event.error !== undefined) {
		return {
			code: STATUS_CODE_ERROR,
			...(event.error !== undefined && { message: event.error.message }),
		};
	}
	return { code: STATUS_CODE_UNSET };
}

function exceptionSpanEvent(
	event: TelemetryEvent,
	timeUnixNano: string,
): JsonObject {
	const error = event.error;
	if (error === undefined) {
		throw new Error("Cannot build exception event without an error.");
	}
	return {
		name: "exception",
		timeUnixNano,
		attributes: keyValues({
			"exception.message": error.message,
			...(error.type !== undefined && { "exception.type": error.type }),
			...(error.code !== undefined && { "exception.code": error.code }),
		}),
	};
}

function toSpanStartUnixNano(
	event: TelemetryEvent,
	endTimeUnixNano: string,
): string {
	const durationMs = event.measurements.durationMs;
	if (durationMs === undefined) {
		return endTimeUnixNano;
	}
	return String(BigInt(endTimeUnixNano) - msToNanos(durationMs));
}

function windowStartUnixNano(
	timeUnixNano: string,
	windowSeconds: number | undefined,
): string {
	if (windowSeconds === undefined) {
		return timeUnixNano;
	}
	return String(BigInt(timeUnixNano) - secondsToNanos(windowSeconds));
}

function toUnixNano(timestamp: string): string {
	const ms = Date.parse(timestamp);
	if (!Number.isFinite(ms)) {
		throw new Error(`Invalid telemetry timestamp '${timestamp}'.`);
	}
	return String(BigInt(ms) * 1_000_000n);
}

function msToNanos(ms: number): bigint {
	return BigInt(Math.max(0, Math.round(ms * 1_000_000)));
}

function secondsToNanos(seconds: number): bigint {
	return BigInt(Math.max(0, Math.round(seconds * 1_000_000_000)));
}

function spanName(eventName: string): string {
	return eventName.split(".").at(-1) ?? eventName;
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
