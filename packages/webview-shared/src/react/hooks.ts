import { useCallback, useEffect, useRef, useState } from "react";

import { getState, setState } from "../api";

/**
 * Listen for messages from the extension. No need to memoize the handler.
 */
export function useMessage<T>(handler: (message: T) => void): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect((): (() => void) => {
		const listener = (event: MessageEvent<T>): void => {
			handlerRef.current(event.data);
		};
		window.addEventListener("message", listener);
		return (): void => {
			window.removeEventListener("message", listener);
		};
	}, []);
}

/**
 * Hook to manage webview state with VS Code's state API
 */
export function useVsCodeState<T>(initialState: T): [T, (state: T) => void] {
	const [state, setLocalState] = useState<T>((): T => {
		const saved = getState<T>();
		return saved ?? initialState;
	});

	const setVsCodeState = useCallback((newState: T): void => {
		setLocalState(newState);
		setState(newState);
	}, []);

	return [state, setVsCodeState];
}
