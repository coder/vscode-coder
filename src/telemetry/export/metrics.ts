import type { TelemetryEvent } from "../event";

export interface MetricMeasurement {
	readonly name: string;
	readonly value: number;
	readonly kind: "gauge" | "counter";
	/** OTel/UCUM unit (e.g. "ms", "Mbit/s", "{request}", "1"). */
	readonly unit: string;
}

/**
 * `windowSeconds` is set on windowed events (`http.requests`) and absent on
 * point-in-time samples; exporters use it to stamp gauge start times and
 * anchor cumulative counters.
 */
export interface MetricDescriptor {
	readonly windowSeconds?: number;
	readonly measurements: readonly MetricMeasurement[];
}

const METRIC_EVENT_NAMES: ReadonlySet<string> = new Set([
	"http.requests",
	"ssh.network.sampled",
]);

const UNIT_SUFFIXES: ReadonlyArray<readonly [string, string]> = [
	["_ms", "ms"],
	["_mbits", "Mbit/s"],
];

export function isMetricEvent(event: TelemetryEvent): boolean {
	return METRIC_EVENT_NAMES.has(event.eventName);
}

export function describeMetricEvent(
	event: TelemetryEvent,
): MetricDescriptor | undefined {
	if (!isMetricEvent(event)) {
		return undefined;
	}
	if (event.eventName === "http.requests") {
		return describeHttpRequests(event);
	}
	return {
		measurements: Object.entries(event.measurements).map(([key, value]) => {
			const { name, unit } = splitUnit(key);
			return { name, value, kind: "gauge", unit };
		}),
	};
}

function describeHttpRequests(event: TelemetryEvent): MetricDescriptor {
	let windowSeconds = 0;
	const measurements: MetricMeasurement[] = [];
	for (const [name, value] of Object.entries(event.measurements)) {
		if (name === "window_seconds") {
			windowSeconds = value;
		} else if (name.startsWith("count.")) {
			measurements.push({ name, value, kind: "counter", unit: "{request}" });
		} else {
			const { name: metricName, unit } = splitUnit(name);
			measurements.push({ name: metricName, value, kind: "gauge", unit });
		}
	}
	return { windowSeconds, measurements };
}

/**
 * Split a measurement key into its metric name and unit, dropping the unit
 * suffix from the name (OTLP carries the unit in a field, not the name):
 * `latency_ms` -> `{ name: "latency", unit: "ms" }`. No known suffix -> "1".
 */
function splitUnit(key: string): { name: string; unit: string } {
	const match = UNIT_SUFFIXES.find(([suffix]) => key.endsWith(suffix));
	return match
		? { name: key.slice(0, -match[0].length), unit: match[1] }
		: { name: key, unit: "1" };
}
