import { useEffect, useState } from "react";

/** A zero delay returns `value` in the same render instead of a tick later. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return delayMs === 0 ? value : debounced;
}
