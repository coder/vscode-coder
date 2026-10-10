import { beforeEach, describe, expect, it, vi } from "vitest";

import { postMessage, getState, setState } from "@repo/webview-shared/api";

let stored: unknown;
const sent: unknown[] = [];

vi.stubGlobal(
	"acquireVsCodeApi",
	vi.fn(() => ({
		postMessage: (msg: unknown) => sent.push(msg),
		getState: () => stored,
		setState: (s: unknown) => (stored = s),
	})),
);

beforeEach(() => {
	stored = undefined;
	sent.length = 0;
});

describe("postMessage", () => {
	it("sends messages to the extension", () => {
		postMessage({ method: "ready" });
		postMessage({ method: "refresh", params: { id: 1 } });

		expect(sent).toEqual([
			{ method: "ready" },
			{ method: "refresh", params: { id: 1 } },
		]);
	});
});

describe("state persistence", () => {
	it("round-trips state through setState and getState", () => {
		const state = { count: 42, items: ["a", "b"] };
		setState(state);

		expect(getState()).toEqual(state);
	});

	it("returns undefined when no state has been set", () => {
		expect(getState()).toBeUndefined();
	});

	it("overwrites previous state", () => {
		setState({ version: 1 });
		setState({ version: 2 });

		expect(getState()).toEqual({ version: 2 });
	});

	it("handles null state", () => {
		setState({ something: true });
		setState(null);

		expect(getState()).toBeNull();
	});
});
