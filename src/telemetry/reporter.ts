import { NOOP_SPAN, type Span } from "./span";

import type { CallerMeasurements, CallerProperties } from "./event";

/**
 * Narrow reporting surface so callers don't have to depend on the full
 * TelemetryService. Pass NOOP_TELEMETRY_REPORTER to opt out.
 */
export interface TelemetryReporter {
	log(
		eventName: string,
		properties?: CallerProperties,
		measurements?: CallerMeasurements,
	): void;
	logError(
		eventName: string,
		error: unknown,
		properties?: CallerProperties,
		measurements?: CallerMeasurements,
	): void;
	trace<T>(
		eventName: string,
		fn: (span: Span) => Promise<T>,
		properties?: CallerProperties,
		measurements?: CallerMeasurements,
	): Promise<T>;
}

export const NOOP_TELEMETRY_REPORTER: TelemetryReporter = {
	log: () => undefined,
	logError: () => undefined,
	trace: (_eventName, fn) => fn(NOOP_SPAN),
};
