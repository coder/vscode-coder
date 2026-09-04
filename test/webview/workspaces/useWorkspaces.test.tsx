import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspacesApi, type WorkspacesUpdate } from "@repo/shared";
import { useWorkspaces } from "@repo/workspaces/hooks/useWorkspaces";

const sent: unknown[] = [];

vi.stubGlobal(
	"acquireVsCodeApi",
	vi.fn(() => ({
		postMessage: (message: unknown) => sent.push(message),
		getState: () => undefined,
		setState: () => {},
	})),
);

/** Push a state update the way the extension does. */
async function push(update: WorkspacesUpdate) {
	await act(async () => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: WorkspacesApi.stateUpdated.method, data: update },
			}),
		);
		await Promise.resolve();
	});
}

const CAPABILITIES = { authenticated: true, filters: ["mine"] } as const;
const LISTED = { filter: "mine", workspaces: [], loading: false } as const;

describe("useWorkspaces", () => {
	it("asks for the state once its subscription is live", () => {
		sent.length = 0;

		renderHook(() => useWorkspaces());

		expect(sent).toEqual([
			{ method: WorkspacesApi.ready.method, params: undefined },
		]);
	});

	it("applies only the fields an update carries", async () => {
		const { result } = renderHook(() => useWorkspaces());

		await push({ capabilities: CAPABILITIES, workspaces: LISTED });
		await push({ error: "network down" });

		expect(result.current.state).toEqual({
			capabilities: CAPABILITIES,
			workspaces: LISTED,
			error: "network down",
		});

		const shared = { filter: "shared", workspaces: [], loading: true } as const;
		await push({ workspaces: shared });

		expect(result.current.state).toEqual({
			capabilities: CAPABILITIES,
			workspaces: shared,
			error: "network down",
		});
	});

	it("stops applying updates once unmounted", async () => {
		const { result, unmount } = renderHook(() => useWorkspaces());
		await push({ capabilities: CAPABILITIES });

		unmount();
		await push({ error: "network down" });

		expect(result.current.state).toEqual({ capabilities: CAPABILITIES });
	});
});
