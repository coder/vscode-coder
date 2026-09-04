import type { Ref } from "react";

/**
 * Hands a node to a consumer's `ref` prop, whichever form it takes, so a
 * component can keep its own ref to a node it also forwards.
 */
export function setForwardedRef<T>(
	ref: Ref<T> | undefined,
	value: T | null,
): void {
	if (typeof ref === "function") {
		ref(value);
	} else if (ref) {
		ref.current = value;
	}
}
