import type { CallerMeasurements, CallerProperties } from "./event";

/**
 * Parent span handle. Children's `eventName` composes as `${parent.eventName}.${phaseName}`.
 * Phase names should not contain `.`; if they do, dots are replaced with `_` and a warning is logged.
 * Recurse via `phase` for grandchildren.
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
		measurements?: CallerMeasurements,
	): Promise<T>;
	/** Add or replace a property on the event emitted for this span. */
	setProperty(name: string, value: string): void;
	/** Add or replace a measurement on the event emitted for this span. */
	setMeasurement(name: string, value: number): void;
	/** Flip this span's `result` from `success` to `aborted` on normal return. */
	markAborted(): void;
}

/** No-op `Span` used when telemetry is off. Runs phase fns but emits nothing. */
export const NOOP_SPAN: Span = {
	traceId: "",
	eventId: "",
	eventName: "",
	phase<T>(_phaseName: string, fn: (span: Span) => Promise<T>): Promise<T> {
		return fn(NOOP_SPAN);
	},
	markAborted(): void {
		return undefined;
	},
	setProperty(): void {
		return undefined;
	},
	setMeasurement(): void {
		return undefined;
	},
};
