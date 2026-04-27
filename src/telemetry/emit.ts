/** Push an event into the telemetry pipeline. @internal */
export type EmitFn = (
	eventName: string,
	properties: Record<string, string>,
	measurements: Record<string, number>,
	traceId?: string,
	error?: unknown,
) => void;

/** Run an async fn and emit one event recording its outcome and `durationMs`. */
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
