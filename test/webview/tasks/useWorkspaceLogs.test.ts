import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TasksApi } from "@repo/shared";
import { useWorkspaceLogs } from "@repo/tasks/hooks/useWorkspaceLogs";

const sent: unknown[] = [];

vi.stubGlobal(
	"acquireVsCodeApi",
	vi.fn(() => ({
		postMessage: (msg: unknown) => sent.push(msg),
		getState: () => undefined,
		setState: () => {},
	})),
);

function notify(lines: string[]) {
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: TasksApi.workspaceLogsAppend.method, data: lines },
			}),
		);
	});
}

describe("useWorkspaceLogs", () => {
	afterEach(() => {
		sent.length = 0;
	});

	it("returns empty array when inactive", () => {
		const { result, unmount } = renderHook(() => useWorkspaceLogs(false));
		expect(result.current).toEqual([]);
		unmount();
	});

	it("accumulates lines from notifications", () => {
		const { result, unmount } = renderHook(() => useWorkspaceLogs(true));

		notify(["line 1", "line 2"]);
		expect(result.current).toEqual(["line 1", "line 2"]);

		notify(["line 3"]);
		expect(result.current).toEqual(["line 1", "line 2", "line 3"]);
		unmount();
	});

	it("ignores notifications when inactive", () => {
		const { result, unmount } = renderHook(() => useWorkspaceLogs(false));

		notify(["ignored"]);
		expect(result.current).toEqual([]);
		unmount();
	});

	it("resets lines when deactivated", () => {
		const { result, rerender, unmount } = renderHook(
			({ active }) => useWorkspaceLogs(active),
			{ initialProps: { active: true } },
		);

		notify(["old line"]);
		expect(result.current).toEqual(["old line"]);

		rerender({ active: false });
		expect(result.current).toEqual([]);
		unmount();
	});

	it("sends closeWorkspaceLogs on cleanup", () => {
		const { unmount } = renderHook(() => useWorkspaceLogs(true));

		unmount();

		expect(sent).toContainEqual(
			expect.objectContaining({
				method: TasksApi.closeWorkspaceLogs.method,
			}),
		);
	});
});
