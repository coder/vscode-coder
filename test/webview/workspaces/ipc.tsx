import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { vi } from "vitest";

import { WorkspacesApi, type WorkspacesState } from "@repo/shared";
import App from "@repo/workspaces/App";

export interface SentMessage {
	method: string;
	params: unknown;
}

// The webview may acquire the VS Code API once per page, so one stub serves
// every test and forwards to the sink the current test installed.
let sink: SentMessage[] = [];
vi.stubGlobal("acquireVsCodeApi", () => ({
	postMessage: (message: SentMessage) => sink.push(message),
	getState: () => undefined,
	setState: () => {},
}));

/** Collects the messages the webview sends from now on. */
export function captureSent(): SentMessage[] {
	const sent: SentMessage[] = [];
	sink = sent;
	return sent;
}

export const pushState = (state: WorkspacesState) =>
	act(async () => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: WorkspacesApi.stateChanged.method, data: state },
			}),
		);
		await Promise.resolve();
	});

/**
 * Mounts the panel as `index.tsx` does, then pushes `state` unless null.
 * `drain` returns the params sent for a method since its last call.
 */
export async function renderApp(state: WorkspacesState | null) {
	const sent = captureSent();
	const user = userEvent.setup();
	const view = render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
	if (state) {
		await pushState(state);
	}
	sent.length = 0;
	const drain = (method: string) => {
		const params = sent.filter((m) => m.method === method).map((m) => m.params);
		sent.splice(0, sent.length, ...sent.filter((m) => m.method !== method));
		return params;
	};
	return { user, drain, ...view };
}
