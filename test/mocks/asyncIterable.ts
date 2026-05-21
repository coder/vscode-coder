/**
 * Wraps a sync array as an `AsyncIterable` that yields one item per microtask,
 * so consumers exercise the same async iteration path they would in production.
 */
export async function* asyncIterable<T>(
	values: readonly T[],
): AsyncGenerator<T> {
	for (const value of values) {
		await Promise.resolve();
		yield value;
	}
}
