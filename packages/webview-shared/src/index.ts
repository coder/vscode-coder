// Webview → Extension message (request or command)
export interface WebviewMessage {
	method: string;
	params?: unknown;
	requestId?: string;
}

// VS Code state API
export { getState, setState, postMessage } from "./api";

// Typed IPC helpers for vanilla webviews
export { sendCommand, onNotification } from "./ipc";
