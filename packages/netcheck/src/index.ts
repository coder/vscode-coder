import { NetcheckApi, toError, type NetcheckData } from "@repo/shared";
import { sendCommand, subscribeNotifications } from "@repo/webview-shared";

import { el } from "./dom";
import "./index.css";
import { renderPage } from "./page";

function main(): void {
	subscribeNotifications(NetcheckApi, {
		data: (data) => {
			try {
				render(data);
			} catch (err) {
				showError(`Failed to render network check: ${toError(err).message}`);
			}
		},
	});
	// Signal we're subscribed; the extension waits for this before sending.
	sendCommand(NetcheckApi.ready);
}

function render(data: NetcheckData): void {
	const root = document.getElementById("root");
	root?.replaceChildren(
		...renderPage(data, () => sendCommand(NetcheckApi.viewJson)),
	);
}

function showError(message: string): void {
	const root = document.getElementById("root");
	root?.replaceChildren(el("p", "error", message));
}

main();
