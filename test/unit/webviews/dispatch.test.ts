import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	dispatchCommand,
	dispatchRequest,
	isIpcCommand,
	isIpcRequest,
	notifyWebview,
	onWhileVisible,
} from "@/webviews/dispatch";

import { defineNotification } from "@repo/shared";

import { createMockLogger } from "../../mocks/testHelpers";

const logger = createMockLogger();
const showError = vi.mocked(vscode.window.showErrorMessage);

beforeEach(() => {
	showError.mockClear();
});

function makeMockWebview() {
	const posted: unknown[] = [];
	const w: vscode.Webview = {
		options: { enableScripts: true, localResourceRoots: [] },
		html: "",
		cspSource: "mock-csp",
		onDidReceiveMessage: () => ({ dispose: () => undefined }),
		postMessage: (msg) => {
			posted.push(msg);
			return Promise.resolve(true);
		},
		asWebviewUri: (uri) => uri,
	};
	return { webview: w, posted };
}

describe("notifyWebview", () => {
	it("posts {type, data} for payload notifications", () => {
		const { webview, posted } = makeMockWebview();
		notifyWebview(
			webview,
			defineNotification<{ count: number }>("ns/updated"),
			{ count: 7 },
		);
		expect(posted).toEqual([{ type: "ns/updated", data: { count: 7 } }]);
	});

	it("omits the data field for void notifications", () => {
		const { webview, posted } = makeMockWebview();
		notifyWebview(webview, defineNotification<void>("ns/refresh"));
		expect(posted).toEqual([{ type: "ns/refresh" }]);
	});

	it("is a no-op when webview is undefined", () => {
		expect(() =>
			notifyWebview(undefined, defineNotification<{ x: number }>("ns/evt"), {
				x: 1,
			}),
		).not.toThrow();
	});
});

describe("dispatchCommand", () => {
	it("invokes the matching handler with params", async () => {
		const handler = vi.fn();
		await dispatchCommand(
			{ method: "do", params: { id: 1 } },
			{ do: handler },
			{ logger },
		);
		expect(handler).toHaveBeenCalledWith({ id: 1 });
	});

	it("does not show errors by default when a handler throws", async () => {
		await dispatchCommand(
			{ method: "do" },
			{ do: vi.fn().mockRejectedValue(new Error("kaboom")) },
			{ logger },
		);
		expect(showError).not.toHaveBeenCalled();
	});

	it("does not show errors by default for unknown commands", async () => {
		await dispatchCommand({ method: "missing" }, {}, { logger });
		expect(showError).not.toHaveBeenCalled();
	});

	it("shows errors when showErrorToUser opts in", async () => {
		await dispatchCommand(
			{ method: "do" },
			{ do: vi.fn().mockRejectedValue(new Error("kaboom")) },
			{ logger, showErrorToUser: () => true },
		);
		expect(showError).toHaveBeenCalledWith("kaboom");
	});
});

describe("dispatchRequest", () => {
	it("posts a success response with the handler's return value", async () => {
		const { webview, posted } = makeMockWebview();
		await dispatchRequest(
			{ requestId: "r1", method: "get", params: { id: 1 } },
			{ get: vi.fn().mockResolvedValue({ ok: true }) },
			webview,
			{ logger },
		);
		expect(posted).toEqual([
			{ requestId: "r1", method: "get", success: true, data: { ok: true } },
		]);
	});

	it("posts a failure response with the handler's error message", async () => {
		const { webview, posted } = makeMockWebview();
		await dispatchRequest(
			{ requestId: "r2", method: "get" },
			{ get: vi.fn().mockRejectedValue(new Error("boom")) },
			webview,
			{ logger },
		);
		expect(posted).toEqual([
			{ requestId: "r2", method: "get", success: false, error: "boom" },
		]);
		expect(showError).not.toHaveBeenCalled();
	});

	it("posts an Unknown request error for missing handlers", async () => {
		const { webview, posted } = makeMockWebview();
		await dispatchRequest({ requestId: "r3", method: "missing" }, {}, webview, {
			logger,
		});
		expect(posted).toEqual([
			{
				requestId: "r3",
				method: "missing",
				success: false,
				error: "Unknown request: missing",
			},
		]);
	});

	it("shows errors only for methods that opt in", async () => {
		const { webview } = makeMockWebview();
		await dispatchRequest(
			{ requestId: "r4", method: "delete" },
			{ delete: vi.fn().mockRejectedValue(new Error("nope")) },
			webview,
			{ logger, showErrorToUser: (m) => m === "delete" },
		);
		expect(showError).toHaveBeenCalledWith("nope");
	});

	it("drops the response silently when the webview is undefined", async () => {
		await expect(
			dispatchRequest(
				{ requestId: "r5", method: "get" },
				{ get: vi.fn().mockResolvedValue("done") },
				undefined,
				{ logger },
			),
		).resolves.toBeUndefined();
	});
});

describe("isIpcRequest", () => {
	it("matches messages with both string requestId and string method", () => {
		expect(isIpcRequest({ requestId: "r1", method: "get" })).toBe(true);
	});

	it("rejects non-string requestId", () => {
		expect(isIpcRequest({ requestId: 1, method: "get" })).toBe(false);
	});

	it("rejects non-string method", () => {
		expect(isIpcRequest({ requestId: "r1", method: 7 })).toBe(false);
	});

	it("rejects messages missing requestId", () => {
		expect(isIpcRequest({ method: "get" })).toBe(false);
	});

	it("rejects null and non-objects", () => {
		expect(isIpcRequest(null)).toBe(false);
		expect(isIpcRequest("string")).toBe(false);
		expect(isIpcRequest(undefined)).toBe(false);
	});
});

describe("isIpcCommand", () => {
	it("matches messages with method but no requestId", () => {
		expect(isIpcCommand({ method: "do" })).toBe(true);
		expect(isIpcCommand({ method: "do", params: { x: 1 } })).toBe(true);
	});

	it("rejects messages with requestId (those are requests)", () => {
		expect(isIpcCommand({ requestId: "r1", method: "do" })).toBe(false);
	});

	it("rejects non-string method", () => {
		expect(isIpcCommand({ method: 7 })).toBe(false);
	});

	it("rejects null and non-objects", () => {
		expect(isIpcCommand(null)).toBe(false);
		expect(isIpcCommand(42)).toBe(false);
	});
});

describe("onWhileVisible", () => {
	function makePanel(visible: boolean) {
		const listeners = new Set<() => void>();
		const event: vscode.Event<unknown> = (cb) => {
			listeners.add(cb as () => void);
			return { dispose: () => listeners.delete(cb as () => void) };
		};
		return {
			panel: { visible },
			event,
			fire: () => listeners.forEach((l) => l()),
		};
	}

	it("fires when the panel is visible", () => {
		const { panel, event, fire } = makePanel(true);
		const handler = vi.fn();
		onWhileVisible(panel, event, handler);
		fire();
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("skips when the panel is hidden", () => {
		const { panel, event, fire } = makePanel(false);
		const handler = vi.fn();
		onWhileVisible(panel, event, handler);
		fire();
		expect(handler).not.toHaveBeenCalled();
	});

	it("unsubscribes on dispose", () => {
		const { panel, event, fire } = makePanel(true);
		const handler = vi.fn();
		onWhileVisible(panel, event, handler).dispose();
		fire();
		expect(handler).not.toHaveBeenCalled();
	});
});
