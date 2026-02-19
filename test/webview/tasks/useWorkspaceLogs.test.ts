import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function renderLogs() {
	sent.length = 0;
	const hook = renderHook(() => useWorkspaceLogs());

	return {
		get lines() {
			return hook.result.current;
		},
		notify(lines: string[]) {
			act(() => {
				window.dispatchEvent(
					new MessageEvent("message", {
						data: {
							type: TasksApi.workspaceLogsAppend.method,
							data: lines,
						},
					}),
				);
				// Flush the requestAnimationFrame batch used by useWorkspaceLogs.
				vi.runAllTimers();
			});
		},
		unmount() {
			hook.unmount();
			return [...sent];
		},
	};
}

describe("useWorkspaceLogs", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("returns empty array initially", () => {
		const h = renderLogs();
		expect(h.lines).toEqual([]);
	});

	it("accumulates lines from notifications", () => {
		const h = renderLogs();

		h.notify(["line 1", "line 2"]);
		expect(h.lines).toEqual(["line 1", "line 2"]);

		h.notify(["line 3"]);
		expect(h.lines).toEqual(["line 1", "line 2", "line 3"]);
	});

	it("sends closeWorkspaceLogs on unmount", () => {
		const h = renderLogs();
		const sent = h.unmount();

		expect(sent).toContainEqual(
			expect.objectContaining({
				method: TasksApi.closeWorkspaceLogs.method,
			}),
		);
	});
});
