// Webview → Extension message (request or command)
export interface WebviewMessage {
	method: string;
	params?: unknown;
	requestId?: string;
}

// VS Code state API
export { getState, setState, postMessage } from "./api";

// IPC helpers for vanilla webviews. React webviews use `useIpc` instead.
export {
	buildNotificationRouter,
	sendCommand,
	subscribeNotifications,
} from "./ipc";

// DOM builders shared by the vanilla webviews.
export { pageHeader, viewJsonAction, emptyMessage, errorMessage } from "./dom";
