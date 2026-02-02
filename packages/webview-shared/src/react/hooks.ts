import { useCallback, useEffect, useEffectEvent, useState } from "react";

import { getState, setState } from "../api";

/**
 * Listen for messages from the extension. No need to memoize the handler.
 */
export function useMessage<T>(handler: (message: T) => void): void {
	const onMessage = useEffectEvent((event: MessageEvent<T>): void => {
		handler(event.data);
	});

	useEffect((): (() => void) => {
		window.addEventListener("message", onMessage);
		return (): void => {
			window.removeEventListener("message", onMessage);
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
