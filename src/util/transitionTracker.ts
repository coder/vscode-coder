/**
 * Tracks the last observed value per key and reports the previous value each
 * time it changes. Shared by the workspace/agent telemetry observers and the
 * corresponding loggers so transition detection lives in one place.
 *
 * A single tracked entity (e.g. a workspace) can omit the key; callers that
 * track many entities (e.g. agents keyed by ID) pass a distinct key each time.
 */
export class TransitionTracker<T> {
	private readonly previous = new Map<string, T>();

	public constructor(private readonly equals: (a: T, b: T) => boolean) {}

	/**
	 * Record `next` for `key`. Returns `{ from }` when it differs from the last
	 * recorded value (`from` is `undefined` on the first observation), or
	 * `undefined` when unchanged.
	 */
	public observe(next: T, key = ""): { from: T | undefined } | undefined {
		const prior = this.previous.get(key);
		if (prior !== undefined && this.equals(prior, next)) {
			return undefined;
		}
		this.previous.set(key, next);
		return { from: prior };
	}

	/** Forget a single key, or all keys when `key` is omitted. */
	public reset(key?: string): void {
		if (key === undefined) {
			this.previous.clear();
		} else {
			this.previous.delete(key);
		}
	}
}
