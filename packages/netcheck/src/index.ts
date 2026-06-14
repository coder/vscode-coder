import { NetcheckApi, toError, type NetcheckData } from "@repo/shared";
import { sendCommand, subscribeNotifications } from "@repo/webview-shared";
import "@repo/webview-shared/base.css";

import "./index.css";
import { renderError, renderPage } from "./page";

function main(): void {
	// The extension re-sends `data` on visibility/theme changes; each render
	// replaces the root, clearing any prior error.
	subscribeNotifications(NetcheckApi, {
		data: (data) => render(data),
	});
	// Signal we're subscribed; the extension waits for this before sending.
	sendCommand(NetcheckApi.ready);
}

function render(data: NetcheckData): void {
	const root = document.getElementById("root");
	if (!root) {
		return;
	}
	try {
		root.replaceChildren(
			...renderPage(data, () => sendCommand(NetcheckApi.viewJson)),
		);
	} catch (err) {
		root.replaceChildren(
			renderError(`Failed to render network check: ${toError(err).message}`),
		);
	}
}

main();
