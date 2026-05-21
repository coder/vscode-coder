import type { TelemetryEvent } from "../event";

/** Telemetry signal an event maps to in an export. */
export type ExportSignal = "log" | "trace" | "metric";

const METRIC_EVENT_NAMES = new Set([
	"http.requests",
	"ssh.network.info",
	"ssh.network.sampled",
]);

/**
 * Classify a `TelemetryEvent` for export. Metric-shaped event names map to
 * `metric`; everything with a `traceId` is a `trace`; otherwise `log`.
 */
export function classifyEvent(event: TelemetryEvent): ExportSignal {
	if (METRIC_EVENT_NAMES.has(event.eventName)) {
		return "metric";
	}
	if (event.traceId !== undefined) {
		return "trace";
	}
	return "log";
}
