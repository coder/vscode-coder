import { useEffect, useEffectEvent, useRef, useState } from "react";

/** Ctrl+F, or Cmd+F on macOS. Ctrl+Shift+F stays VS Code's global search. */
function isFindKey(event: KeyboardEvent): boolean {
	return (
		(event.ctrlKey || event.metaKey) &&
		!event.shiftKey &&
		!event.altKey &&
		event.key.toLowerCase() === "f"
	);
}

/**
 * The panel's search box, closed until the title bar's Search button or
 * Ctrl+F opens it. `query` is the lowercased text to match.
 */
export function useWorkspaceSearch(
	/** Subscribes to the title bar's Search button; returns the unsubscribe. */
	onShowSearch: (listener: () => void) => () => void,
) {
	/** Undefined while the search box is closed. */
	const [value, setValue] = useState<string>();
	const inputRef = useRef<HTMLInputElement>(null);

	const open = useEffectEvent(() => {
		setValue((current) => current ?? "");
		inputRef.current?.focus();
	});

	useEffect(() => onShowSearch(() => open()), [onShowSearch]);

	useEffect(() => {
		// VS Code sends Ctrl+F from a webview view to the editor's find, so
		// take it in the capture phase, before the webview host forwards it.
		const onKeyDown = (event: KeyboardEvent) => {
			if (isFindKey(event)) {
				event.preventDefault();
				event.stopPropagation();
				open();
			}
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, []);

	return {
		isOpen: value !== undefined,
		value: value ?? "",
		query: value?.trim().toLowerCase() ?? "",
		inputRef,
		setValue,
		close: () => setValue(undefined),
	};
}
