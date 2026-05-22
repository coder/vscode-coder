import type { TelemetryEvent } from "../event";

/** One measurement, classified for export. */
export interface MetricMeasurement {
	readonly name: string;
	readonly value: number;
	readonly kind: "gauge" | "counter";
	/** OTel/UCUM unit (e.g. "ms", "Mbit/s", "{request}", "1"). */
	readonly unit: string;
}

/**
 * Typed view of a metric event. `windowSeconds` is set on windowed events
 * (`http.requests`) and absent on point-in-time samples; exporters use it to
 * stamp gauge start times and anchor cumulative counters.
 */
export interface MetricDescriptor {
	readonly windowSeconds?: number;
	readonly measurements: readonly MetricMeasurement[];
}

// Single source of truth for which event names are metric series.
const METRIC_EVENT_NAMES: ReadonlySet<string> = new Set([
	"http.requests",
	"ssh.network.info",
	"ssh.network.sampled",
]);

export function isMetricEvent(event: TelemetryEvent): boolean {
	return METRIC_EVENT_NAMES.has(event.eventName);
}

/** Typed layout for a metric event, or `undefined` if it isn't a metric. */
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

// `window_seconds` is metadata, `count_*` are cumulative counters, the rest gauges.
function describeHttpRequests(event: TelemetryEvent): MetricDescriptor {
	let windowSeconds = 0;
	const measurements: MetricMeasurement[] = [];
	for (const [name, value] of Object.entries(event.measurements)) {
		if (name === "window_seconds") {
			windowSeconds = value;
		} else if (name.startsWith("count_")) {
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
	if (name.endsWith("_ms") || name.endsWith("Ms")) {
		return "ms";
	}
	if (name.endsWith("Mbits")) {
		return "Mbit/s";
	}
	return "1";
}
