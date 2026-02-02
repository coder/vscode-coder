import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMessage, useVsCodeState } from "@repo/webview-shared/react/hooks";

let stored: unknown;

vi.stubGlobal(
	"acquireVsCodeApi",
	vi.fn(() => ({
		postMessage: vi.fn(),
		getState: () => stored,
		setState: (s: unknown) => (stored = s),
	})),
);

beforeEach(() => {
	stored = undefined;
});

function dispatchMessage(data: unknown) {
	window.dispatchEvent(new MessageEvent("message", { data }));
}

describe("useMessage", () => {
	it("receives dispatched messages", () => {
		const received: unknown[] = [];

		renderHook(() => useMessage((msg) => received.push(msg)));

		act(() => {
			dispatchMessage({ type: "first" });
			dispatchMessage({ type: "second", value: 42 });
		});

		expect(received).toEqual([
			{ type: "first" },
			{ type: "second", value: 42 },
		]);
	});

	it("stops receiving messages after unmount", () => {
		const received: unknown[] = [];

		const { unmount } = renderHook(() =>
			useMessage((msg) => received.push(msg)),
		);

		act(() => dispatchMessage({ type: "before" }));
		unmount();
		act(() => dispatchMessage({ type: "after" }));

		expect(received).toEqual([{ type: "before" }]);
	});

	it("always calls the current handler, not a stale one", () => {
		let currentPrefix = "old";
		const log: string[] = [];

		const { rerender } = renderHook(() =>
			useMessage(() => log.push(currentPrefix)),
		);

		currentPrefix = "new";
		rerender();

		act(() => dispatchMessage({ type: "test" }));

		// Should use "new", not the original "old"
		expect(log).toEqual(["new"]);
	});
});

describe("useVsCodeState", () => {
	it("initializes with provided value when no saved state exists", () => {
		const { result } = renderHook(() => useVsCodeState({ count: 0 }));
		const [state] = result.current;

		expect(state).toEqual({ count: 0 });
	});

	it("restores saved state on mount", () => {
		stored = { count: 42 };

		const { result } = renderHook(() => useVsCodeState({ count: 0 }));
		const [state] = result.current;

		expect(state).toEqual({ count: 42 });
	});

	it("updates and persists state", () => {
		const { result } = renderHook(() => useVsCodeState({ value: "initial" }));

		act(() => {
			const [, setState] = result.current;
			setState({ value: "updated" });
		});

		const [state] = result.current;
		expect(state).toEqual({ value: "updated" });
		expect(stored).toEqual({ value: "updated" });
	});

	it("persists state across remounts", () => {
		const { result, unmount } = renderHook(() => useVsCodeState({ x: 1 }));

		act(() => {
			const [, setState] = result.current;
			setState({ x: 99 });
		});
		unmount();

		const { result: result2 } = renderHook(() => useVsCodeState({ x: 1 }));
		const [state] = result2.current;
		expect(state).toEqual({ x: 99 });
	});

	it("returns a stable setter function", () => {
		const { result, rerender } = renderHook(() => useVsCodeState({ x: 1 }));

		const [, setterBefore] = result.current;
		rerender();
		const [, setterAfter] = result.current;

		expect(setterBefore).toBe(setterAfter);
	});
});
