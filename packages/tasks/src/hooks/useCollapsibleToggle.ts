import { useEffect, useRef, useState } from "react";

/**
 * Tracks the open/closed state of a VscodeCollapsible by listening for the
 * unmapped `vsc-collapsible-toggle` custom event via ref.
 */
export function useCollapsibleToggle<T extends HTMLElement & { open: boolean }>(
	initial: boolean,
): [React.RefObject<T | null>, boolean, (v: boolean) => void] {
	const ref = useRef<T>(null);
	const [open, setOpen] = useState(initial);

	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return undefined;
		}

		function handleToggle(e: Event) {
			setOpen((e as CustomEvent<{ open: boolean }>).detail.open);
		}

		el.addEventListener("vsc-collapsible-toggle", handleToggle);
		return () => el.removeEventListener("vsc-collapsible-toggle", handleToggle);
	}, []);

	return [ref, open, setOpen];
}
