// Message passing types - simple generic interface
export interface WebviewMessage<T = unknown> {
	type: string;
	data?: T;
	// Request-response pattern support
	requestId?: string;
	payload?: unknown;
}

// VS Code state API
export { getState, setState, postMessage } from "./api";

// Tasks types - re-exported from tasks submodule
export * from "./tasks";
