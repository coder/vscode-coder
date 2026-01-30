import { useCallback, useEffect, useState } from "react";

import { getState, setState } from "../api";

import type { WebviewMessage } from "../index";

/**
 * Hook to listen for messages from the extension
 */
export function useMessage<T = unknown>(
	handler: (message: WebviewMessage<T>) => void,
): void {
	useEffect((): (() => void) => {
		const listener = (event: MessageEvent<WebviewMessage<T>>): void => {
			handler(event.data);
		};
		window.addEventListener("message", listener);
		return (): void => {
			window.removeEventListener("message", listener);
		};
	}, [handler]);
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
