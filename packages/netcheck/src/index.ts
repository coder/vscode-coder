import { NetcheckApi, toError, type NetcheckData } from "@repo/shared";
import { sendCommand, subscribeNotifications } from "@repo/webview-shared";

import "./index.css";
import { renderError, renderPage } from "./page";

function main(): void {
	// The extension re-sends `data` on visibility/theme changes, so each render
	// replaces the whole root, clearing any prior error or report.
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
