import { ChatApi } from "@repo/shared";
import { sendCommand, subscribeNotifications } from "@repo/webview-shared";

import "./index.css";

/**
 * Chat shim. Bridges the iframe's foreign `{ type, payload }` protocol
 * and the extension's `ChatApi`. The iframe and status div are
 * pre-rendered in the panel's HTML; the bundle just attaches listeners.
 */

const iframe = document.getElementById("chat-frame") as HTMLIFrameElement;
const status = document.getElementById("status") as HTMLDivElement;
const allowedOrigin = new URL(iframe.src).origin;

iframe.addEventListener("load", () => {
	iframe.style.display = "block";
	status.style.display = "none";
});

function toIframe(type: string, payload: unknown): void {
	iframe.contentWindow?.postMessage({ type, payload }, allowedOrigin);
}

function showRetry(error: string): void {
	status.textContent = "";
	status.appendChild(
		document.createTextNode(error || "Authentication failed."),
	);
	const btn = document.createElement("button");
	btn.id = "retry-btn";
	btn.textContent = "Retry";
	btn.addEventListener("click", () => {
		status.textContent = "Authenticating…";
		sendCommand(ChatApi.vscodeReady);
	});
	status.appendChild(document.createElement("br"));
	status.appendChild(btn);
	status.style.display = "block";
	iframe.style.display = "none";
}

// Compile-checked: a new ChatApi notification without a handler fails the build.
subscribeNotifications(ChatApi, {
	setTheme: ({ theme }) => toIframe("coder:set-theme", { theme }),
	authBootstrapToken: ({ token }) => {
		status.textContent = "Signing in…";
		toIframe("coder:vscode-auth-bootstrap", { token });
	},
	authError: ({ error }) => showRetry(error),
});

// Iframe -> extension. `msg.type` strings are the foreign Coder protocol;
// every `sendCommand(ChatApi.X)` below is still type-checked.
window.addEventListener("message", (event) => {
	if (event.source !== iframe.contentWindow) {
		return;
	}
	if (typeof event.data !== "object" || event.data === null) {
		return;
	}
	const msg = event.data as { type?: string; payload?: { url?: string } };
	switch (msg.type) {
		case "coder:vscode-ready":
			status.textContent = "Authenticating…";
			sendCommand(ChatApi.vscodeReady);
			return;
		case "coder:chat-ready":
			sendCommand(ChatApi.chatReady);
			return;
		case "coder:navigate":
			if (msg.payload?.url) {
				sendCommand(ChatApi.navigate, { url: msg.payload.url });
			}
			return;
		default:
			return;
	}
});
