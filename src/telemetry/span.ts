import type {
	CallerMeasurements,
	CallerProperties,
	CallerPropertyValue,
} from "./event";

export type SpanResult = "success" | "aborted" | "error";

/**
 * Parent span handle. Child phases and logs compose as `${parent.eventName}.${name}`.
 * Child names should not contain `.`; if they do, dots are replaced with `_` and a warning is logged.
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
	/** Emit a point-in-time log event under this span. No framework-set `result` or `durationMs`. */
	log(
		logName: string,
		properties?: CallerProperties,
		measurements?: CallerMeasurements,
	): void;
	/** Emit a point-in-time error log event under this span. No framework-set `result` or `durationMs`. */
	logError(
		logName: string,
		error: unknown,
		properties?: CallerProperties,
		measurements?: CallerMeasurements,
	): void;
	/** Add or replace a property on the event emitted for this span. */
	setProperty(name: string, value: CallerPropertyValue): void;
	/** Add or replace a measurement on the event emitted for this span. */
	setMeasurement(name: string, value: number): void;
	/** Flip this span's `result` from `success` to `aborted` on normal return. */
	markAborted(): void;
	/** Flip `result` to `error` for an error captured in the return value. See `SpanResult`. */
	markError(): void;
}

/** No-op `Span` used when telemetry is off. Runs phase fns but emits nothing. */
export const NOOP_SPAN: Span = {
	traceId: "",
	eventId: "",
	eventName: "",
	phase<T>(_phaseName: string, fn: (span: Span) => Promise<T>): Promise<T> {
		return fn(NOOP_SPAN);
	},
	log: () => undefined,
	logError: () => undefined,
	markAborted: () => undefined,
	markError: () => undefined,
	setProperty: () => undefined,
	setMeasurement: () => undefined,
};
