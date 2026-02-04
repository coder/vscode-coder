import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCommand, defineRequest } from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";

const sent: unknown[] = [];

vi.stubGlobal(
	"acquireVsCodeApi",
	vi.fn(() => ({
		postMessage: (msg: unknown) => sent.push(msg),
		getState: () => undefined,
		setState: () => {},
	})),
);

function simulateResponse(response: {
	requestId: string;
	success: boolean;
	data?: unknown;
	error?: string;
}) {
	window.dispatchEvent(new MessageEvent("message", { data: response }));
}

const flush = () => Promise.resolve();

beforeEach(() => {
	sent.length = 0;
});

describe("useIpc", () => {
	describe("request", () => {
		it("sends message with method, scope, params, and requestId", () => {
			const { result, unmount } = renderHook(() => useIpc());
			const req = defineRequest<{ id: string }, string>("getItem", "test");

			act(() => {
				void result.current.request(req, { id: "123" });
			});

			const msg = sent[0] as Record<string, unknown>;
			expect(msg).toMatchObject({
				method: "getItem",
				scope: "test",
				params: { id: "123" },
			});
			expect(typeof msg.requestId).toBe("string");

			// Cleanup
			act(() =>
				simulateResponse({ requestId: msg.requestId as string, success: true }),
			);
			unmount();
		});

		it("resolves when response.success is true", async () => {
			const { result, unmount } = renderHook(() => useIpc());
			const req = defineRequest<void, { value: number }>("getValue");

			let resolved: { value: number } | undefined;
			act(() => {
				void result.current.request(req).then((v) => (resolved = v));
			});

			const requestId = (sent[0] as { requestId: string }).requestId;
			await act(async () => {
				simulateResponse({ requestId, success: true, data: { value: 42 } });
				await flush();
			});

			expect(resolved).toEqual({ value: 42 });
			unmount();
		});

		it("rejects when response.success is false", async () => {
			const { result, unmount } = renderHook(() => useIpc());
			const req = defineRequest<void, string>("fail");

			let error: Error | undefined;
			act(() => {
				void result.current.request(req).catch((e) => (error = e));
			});

			const requestId = (sent[0] as { requestId: string }).requestId;
			await act(async () => {
				simulateResponse({ requestId, success: false, error: "Bad request" });
				await flush();
			});

			expect(error?.message).toBe("Bad request");
			unmount();
		});

		it("rejects with default message when error is empty", async () => {
			const { result, unmount } = renderHook(() => useIpc());
			const req = defineRequest<void, void>("empty");

			let error: Error | undefined;
			act(() => {
				void result.current.request(req).catch((e) => (error = e));
			});

			const requestId = (sent[0] as { requestId: string }).requestId;
			await act(async () => {
				simulateResponse({ requestId, success: false });
				await flush();
			});

			expect(error?.message).toBe("Request failed");
			unmount();
		});

		it("ignores responses with unknown requestId", async () => {
			const { result, unmount } = renderHook(() => useIpc());
			const req = defineRequest<void, number>("test");

			let resolved = false;
			act(() => {
				void result.current.request(req).then(() => (resolved = true));
			});

			await act(async () => {
				simulateResponse({ requestId: "unknown", success: true, data: 1 });
				await flush();
			});

			expect(resolved).toBe(false);

			// Cleanup
			const requestId = (sent[0] as { requestId: string }).requestId;
			act(() => simulateResponse({ requestId, success: true, data: 0 }));
			unmount();
		});
	});

	describe("timeout", () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it("rejects after timeout", async () => {
			const { result, unmount } = renderHook(() => useIpc({ timeoutMs: 100 }));
			const req = defineRequest<void, void>("slow");

			let error: Error | undefined;
			act(() => {
				void result.current.request(req).catch((e) => (error = e));
			});

			await act(async () => {
				vi.advanceTimersByTime(100);
				await flush();
			});

			expect(error?.message).toBe("Request timeout: slow");
			unmount();
		});

		it("defaults to 30 second timeout", async () => {
			const { result, unmount } = renderHook(() => useIpc());
			const req = defineRequest<void, void>("default");

			let rejected = false;
			act(() => {
				void result.current.request(req).catch(() => (rejected = true));
			});

			await act(async () => {
				vi.advanceTimersByTime(29999);
				await flush();
			});
			expect(rejected).toBe(false);

			await act(async () => {
				vi.advanceTimersByTime(1);
				await flush();
			});
			expect(rejected).toBe(true);
			unmount();
		});
	});

	describe("command", () => {
		it("sends message without requestId", () => {
			const { result, unmount } = renderHook(() => useIpc());
			const cmd = defineCommand<{ action: string }>("doAction", "scope");

			act(() => {
				result.current.command(cmd, { action: "save" });
			});

			expect(sent[0]).toMatchObject({
				method: "doAction",
				scope: "scope",
				params: { action: "save" },
			});
			unmount();
		});
	});

	describe("scope", () => {
		interface ScopeTestCase {
			name: string;
			hookScope: string | undefined;
			definitionScope: string;
			expected: string;
		}
		it.each<ScopeTestCase>([
			{
				name: "hook scope overrides definition",
				hookScope: "h",
				definitionScope: "d",
				expected: "h",
			},
			{
				name: "falls back to definition scope",
				hookScope: undefined,
				definitionScope: "d",
				expected: "d",
			},
		])("$name", ({ hookScope, definitionScope, expected }) => {
			const { result, unmount } = renderHook(() =>
				useIpc({ scope: hookScope }),
			);
			const req = defineRequest<void, void>("test", definitionScope);

			act(() => {
				void result.current.request(req);
			});

			expect((sent[0] as { scope: string }).scope).toBe(expected);

			// Cleanup
			const requestId = (sent[0] as { requestId: string }).requestId;
			act(() => simulateResponse({ requestId, success: true }));
			unmount();
		});
	});

	describe("cleanup", () => {
		it("rejects pending requests on unmount", async () => {
			const { result, unmount } = renderHook(() => useIpc());
			const req = defineRequest<void, void>("pending");

			let error: Error | undefined;
			act(() => {
				void result.current.request(req).catch((e) => (error = e));
			});

			await act(async () => {
				unmount();
				await flush();
			});

			expect(error?.message).toBe("Component unmounted");
		});

		it("removes message listener on unmount", () => {
			const spy = vi.spyOn(window, "removeEventListener");
			const { unmount } = renderHook(() => useIpc());

			act(() => unmount());

			expect(spy).toHaveBeenCalledWith("message", expect.any(Function));
			spy.mockRestore();
		});
	});
});
