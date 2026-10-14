import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { agentMetadata, workspace } from "@repo/mocks";
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
				data: {
					type: WorkspacesApi.stateChanged.method,
					data: JSON.parse(JSON.stringify(state)),
				},
			}),
		);
		await Promise.resolve();
	});

describe("useWorkspaces", () => {
	it("asks for state once and keeps its commands stable across updates", async () => {
		const { sent, result, rerender } = setup();
		const api = result.current.api;
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
		rerender();
		expect(result.current.api).toBe(api);
		expect(sent).toEqual([
			{ method: WorkspacesApi.ready.method, params: undefined },
		]);
	});

	it("shares unchanged JSON data while applying metadata and workspace changes", async () => {
		const { result } = setup();
		const first: WorkspacesState = {
			...STATE,
			workspaces: [
				workspace({ id: "first", name: "first" }),
				workspace({ id: "second", name: "second" }),
			],
		};
		await push(first);
		const initial = result.current.state;
		await push(first);
		expect(result.current.state).toBe(initial);

		const metadata = {
			"agent-1": { kind: "reported", metadata: [agentMetadata()] },
		} as const;
		await push({ ...first, metadata });
		expect(result.current.state?.metadata).toEqual(metadata);
		expect(result.current.state?.workspaces).toBe(initial?.workspaces);

		const updated: WorkspacesState = {
			...first,
			metadata,
			workspaces: first.workspaces.map((value) =>
				value.id === "first" ? { ...value, name: "renamed" } : value,
			),
		};
		await push(updated);
		expect(result.current.state?.workspaces[0].name).toBe("renamed");
		expect(result.current.state?.workspaces[1]).toBe(initial?.workspaces[1]);
	});

	it("stops applying pushes once unmounted", async () => {
		const { result, unmount } = setup();
		await push(STATE);
		unmount();
		await push({ ...STATE, filter: "shared" });
		expect(result.current.state).toEqual(STATE);
	});
});
