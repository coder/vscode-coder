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
	["Ms", "ms"],
	["Mbits", "Mbit/s"],
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
		measurements: Object.entries(event.measurements).map(([name, value]) => ({
			name,
			value,
			kind: "gauge",
			unit: measurementUnit(name),
		})),
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
			measurements.push({
				name,
				value,
				kind: "gauge",
				unit: measurementUnit(name),
			});
		}
	}
	return { windowSeconds, measurements };
}

function measurementUnit(name: string): string {
	return UNIT_SUFFIXES.find(([suffix]) => name.endsWith(suffix))?.[1] ?? "1";
}
