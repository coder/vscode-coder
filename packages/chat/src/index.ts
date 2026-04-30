import { ChatApi, type NotificationHandlerMap } from "@repo/shared";
import { buildNotificationRouter, sendCommand } from "@repo/webview-shared";

import "./index.css";

/** Chat shim: source-gated bridge between the iframe `{ type, payload }` protocol and `ChatApi`. */
export function main(): void {
	const shim = findShim();
	if (!shim) {
		return;
	}
	revealIframeOnLoad(shim);
	listenForMessages(shim);
}

interface Shim {
	iframe: HTMLIFrameElement;
	status: HTMLDivElement;
	allowedOrigin: string;
}

interface IframeMessage {
	type?: string;
	payload?: { url?: string };
}

function findShim(): Shim | null {
	const iframe = document.getElementById("chat-frame");
	const status = document.getElementById("status");
	if (
		!(iframe instanceof HTMLIFrameElement) ||
		!(status instanceof HTMLDivElement)
	) {
		return null;
	}
	return { iframe, status, allowedOrigin: new URL(iframe.src).origin };
}

function revealIframeOnLoad({ iframe, status }: Shim): void {
	iframe.addEventListener("load", () => {
		iframe.style.display = "block";
		status.style.display = "none";
	});
}

function listenForMessages(shim: Shim): void {
	const route = buildNotificationRouter(
		ChatApi,
		buildNotificationHandlers(shim),
	);
	window.addEventListener("message", (event) => {
		if (event.source === shim.iframe.contentWindow) {
			if (typeof event.data === "object" && event.data !== null) {
				handleFromIframe(shim, event.data as IframeMessage);
			}
			return;
		}
		route(event.data);
	});
}

function handleFromIframe({ status }: Shim, msg: IframeMessage): void {
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
}

// Compile-checked: a new ChatApi notification without a handler fails the build.
function buildNotificationHandlers(
	shim: Shim,
): NotificationHandlerMap<typeof ChatApi> {
	return {
		setTheme: ({ theme }) => postToIframe(shim, "coder:set-theme", { theme }),
		authBootstrapToken: ({ token }) => {
			shim.status.textContent = "Signing in…";
			postToIframe(shim, "coder:vscode-auth-bootstrap", { token });
		},
		authError: ({ error }) => showRetry(shim, error),
	};
}

function postToIframe(
	{ iframe, allowedOrigin }: Shim,
	type: string,
	payload: unknown,
): void {
	iframe.contentWindow?.postMessage({ type, payload }, allowedOrigin);
}

function showRetry({ iframe, status }: Shim, error: string): void {
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

main();
