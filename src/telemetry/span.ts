import { type CallerProperties } from "./event";

/**
 * Parent span handle. Children's `eventName` composes as `${parent.eventName}.${phaseName}`;
 * phase names must not contain `.`. Recurse via `phase` for grandchildren.
 */
export interface Span {
	readonly traceId: string;
	readonly eventId: string;
	readonly eventName: string;
	/** Emit a child phase event. Framework sets `result` and `durationMs`. */
	phase<T>(
		phaseName: string,
		fn: (span: Span) => Promise<T>,
		properties?: CallerProperties,
		measurements?: Record<string, number>,
	): Promise<T>;
}

/** No-op `Span` used when telemetry is off. Runs phase fns but emits nothing. */
export const NOOP_SPAN: Span = {
	traceId: "",
	eventId: "",
	eventName: "",
	phase<T>(
		_phaseName: string,
		fn: (span: Span) => Promise<T>,
		_properties?: CallerProperties,
		_measurements?: Record<string, number>,
	): Promise<T> {
		return fn(this);
	},
};
