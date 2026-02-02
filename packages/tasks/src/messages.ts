import { postMessage } from "@repo/webview-shared/api";

import type { TasksWebviewMessage } from "@repo/webview-shared";

function sendMessage(message: TasksWebviewMessage): void {
	postMessage(message);
}

/** Signal to the extension that the webview is ready */
export function sendReady(): void {
	sendMessage({ type: "ready" });
}

/** Request task refresh from the extension */
export function sendRefresh(): void {
	sendMessage({ type: "refresh" });
}
