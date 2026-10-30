import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspacesApi, type WorkspacesState } from "@repo/shared";
import { useWorkspaces } from "@repo/workspaces/hooks/useWorkspaces";

import { captureSent, pushState } from "../ipc";

const STATE: WorkspacesState = {
	capabilities: { authenticated: true, filters: ["mine"] },
	filter: "mine",
	workspaces: [],
	status: { kind: "ready" },
	metadata: {},
};

function setup() {
	const sent = captureSent();
	return { sent, ...renderHook(() => useWorkspaces()) };
}

describe("useWorkspaces", () => {
	it("asks for state once and keeps its commands stable across updates", async () => {
		const { sent, result, rerender } = setup();
		const api = result.current.api;
		expect(sent).toEqual([
			{ method: WorkspacesApi.ready.method, params: undefined },
		]);
		expect(result.current.state).toBeUndefined();

		await pushState(STATE);
		expect(result.current.state).toEqual(STATE);

		const failed: WorkspacesState = {
			...STATE,
			status: { kind: "failed", error: "down" },
		};
		await pushState(failed);
		expect(result.current.state).toEqual(failed);
		rerender();
		expect(result.current.api).toBe(api);
		expect(sent).toEqual([
			{ method: WorkspacesApi.ready.method, params: undefined },
		]);
	});

	it("stops applying pushes once unmounted", async () => {
		const { result, unmount } = setup();
		await pushState(STATE);
		unmount();
		await pushState({ ...STATE, filter: "shared" });
		expect(result.current.state).toEqual(STATE);
	});
});
