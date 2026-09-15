import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspacesApi, type WorkspacesState } from "@repo/shared";
import { useWorkspaces } from "@repo/workspaces/hooks/useWorkspaces";

// The webview may acquire the VS Code API once per page, so one stub serves
// every test and forwards to the sink the current test installed.
let sink: unknown[] = [];
vi.stubGlobal("acquireVsCodeApi", () => ({
	postMessage: (message: unknown) => sink.push(message),
	getState: () => undefined,
	setState: () => {},
}));

const STATE: WorkspacesState = {
	capabilities: { authenticated: true, filters: ["mine"] },
	filter: "mine",
	workspaces: [],
	status: { kind: "ready" },
	metadata: {},
};

function setup() {
	const sent: unknown[] = [];
	sink = sent;
	return { sent, ...renderHook(() => useWorkspaces()) };
}

/** Push the state the way the extension does. */
const push = (state: WorkspacesState) =>
	act(async () => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: WorkspacesApi.stateChanged.method, data: state },
			}),
		);
		await Promise.resolve();
	});

describe("useWorkspaces", () => {
	it("asks for the state, then replaces its own with each push", async () => {
		const { sent, result } = setup();
		expect(sent).toEqual([
			{ method: WorkspacesApi.ready.method, params: undefined },
		]);
		expect(result.current.state).toBeUndefined();

		await push(STATE);
		expect(result.current.state).toEqual(STATE);

		const failed: WorkspacesState = {
			...STATE,
			status: { kind: "failed", error: "down" },
		};
		await push(failed);
		expect(result.current.state).toEqual(failed);
	});

	it("stops applying pushes once unmounted", async () => {
		const { result, unmount } = setup();
		await push(STATE);
		unmount();
		await push({ ...STATE, filter: "shared" });
		expect(result.current.state).toEqual(STATE);
	});
});
