/**
 * Internal contract used by `Trace` to push events through the service.
 * @internal
 */
export type EmitFn = (
	eventName: string,
	properties: Record<string, string>,
	measurements: Record<string, number>,
	traceId?: string,
	error?: unknown,
) => void;

/**
 * Run an async operation and emit a single event recording its outcome and
 * `durationMs`. Used by `time`, `trace`, and `Trace.phase` to share the
 * success/error reporting pattern.
 */
export async function emitTimed<T>(
	emit: EmitFn,
	eventName: string,
	fn: () => Promise<T>,
	properties: Record<string, string>,
	traceId?: string,
): Promise<T> {
	const start = performance.now();
	const send = (result: "success" | "error", error?: unknown): void =>
		emit(
			eventName,
			{ ...properties, result },
			{ durationMs: performance.now() - start },
			traceId,
			error,
		);
	try {
		const value = await fn();
		send("success");
		return value;
	} catch (err) {
		send("error", err);
		throw err;
	}
}

/**
 * Correlation handle for a multi-phase operation. The same `traceId` is
 * shared by the parent event and every child phase event.
 */
export class Trace {
	constructor(
		private readonly parentEventName: string,
		public readonly traceId: string,
		private readonly emit: EmitFn,
	) {}

	phase<T>(
		phaseName: string,
		fn: () => Promise<T>,
		properties: Record<string, string> = {},
	): Promise<T> {
		return emitTimed(
			this.emit,
			`${this.parentEventName}.phase`,
			fn,
			{ ...properties, phase: phaseName },
			this.traceId,
		);
	}
}
