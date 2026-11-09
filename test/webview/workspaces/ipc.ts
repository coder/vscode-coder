import { act } from "@testing-library/react";
import { vi } from "vitest";

import { WorkspacesApi, type WorkspacesState } from "@repo/shared";

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
