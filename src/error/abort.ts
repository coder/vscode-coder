/** Check whether an unknown thrown value is an AbortError (signal cancellation). */
export function isAbortError(error: unknown): error is Error {
	return error instanceof Error && error.name === "AbortError";
}

/**
 * Like AbortSignal.throwIfAborted() but coerces non-Error reasons (e.g. the
 * default DOMException) to a named AbortError so isAbortError matches them.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	throw toAbortError(signal.reason);
}

function toAbortError(reason: unknown): Error {
	return reason instanceof Error
		? reason
		: Object.assign(new Error("Aborted"), { name: "AbortError" });
}

/**
 * Await `promise`, rejecting with an AbortError as soon as `signal` aborts.
 * The underlying work is abandoned, not stopped; use for operations that
 * cannot take a signal themselves.
 */
export async function raceWithAbort<T>(
	promise: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	throwIfAborted(signal);
	let onAbort!: () => void;
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(toAbortError(signal.reason));
	});
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		return await Promise.race([promise, aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
