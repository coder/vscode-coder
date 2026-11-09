import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { workspace } from "@repo/mocks";
import { WorkspacesApi, type WorkspacesState } from "@repo/shared";
import { useWorkspaces } from "@repo/workspaces/hooks/useWorkspaces";

import { QueryWrapper } from "../../render";
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
	return {
		sent,
		...renderHook(() => useWorkspaces(), { wrapper: QueryWrapper }),
	};
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

	it("keeps unchanged workspaces by identity, so only changed rows render", async () => {
		const { result } = setup();
		const alpha = workspace({ id: "alpha" });
		const beta = workspace({ id: "beta" });
		await pushState({ ...STATE, workspaces: [alpha, beta] });
		const [first, second] = result.current.state?.workspaces ?? [];

		await pushState({
			...STATE,
			workspaces: [
				JSON.parse(JSON.stringify(alpha)) as typeof alpha,
				workspace({ id: "beta", latest_build: { status: "stopping" } }),
			],
		});

		const [nextFirst, nextSecond] = result.current.state?.workspaces ?? [];
		expect(nextFirst).toBe(first);
		expect(nextSecond).not.toBe(second);
		expect(nextSecond?.latest_build.status).toBe("stopping");
	});

	it("stops applying pushes once unmounted", async () => {
		const { result, unmount } = setup();
		await pushState(STATE);
		unmount();
		await pushState({ ...STATE, filter: "shared" });
		expect(result.current.state).toEqual(STATE);
	});
});
