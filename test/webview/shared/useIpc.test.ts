import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCommand, defineNotification, defineRequest } from "@repo/shared";
import { useIpc, type UseIpcOptions } from "@repo/webview-shared/react";

const sent: unknown[] = [];

vi.stubGlobal(
	"acquireVsCodeApi",
	vi.fn(() => ({
		postMessage: (msg: unknown) => sent.push(msg),
		getState: () => undefined,
		setState: () => {},
	})),
);

/** Get requestId from the last sent message */
const lastRequestId = () =>
	(sent[sent.length - 1] as { requestId: string }).requestId;

/** Simulate a successful response */
async function respond<T>(requestId: string, data?: T) {
	await act(async () => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { requestId, success: true, data },
			}),
		);
		await Promise.resolve();
	});
}

/** Simulate a failed response */
async function respondError(requestId: string, error: string) {
	await act(async () => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { requestId, success: false, error },
			}),
		);
		await Promise.resolve();
	});
}

/** Simulate a notification from the extension */
function notify<T>(type: string, data?: T) {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: { type, data } }));
	});
}

describe("useIpc", () => {
	let unmount: () => void;

	beforeEach(() => {
		sent.length = 0;
	});

	afterEach(() => {
		unmount?.();
	});

	/** Render the hook and register unmount for automatic cleanup */
	function renderIpc(options?: UseIpcOptions) {
		const hook = renderHook(() => useIpc(options));
		unmount = hook.unmount;
		return hook.result;
	}

	describe("request", () => {
		it("sends message with method, params, and requestId", async () => {
			const result = renderIpc();
			const req = defineRequest<{ id: string }, string>("getItem");

			act(() => {
				void result.current.request(req, { id: "123" });
			});

			const msg = sent[0] as Record<string, unknown>;
			expect(msg).toMatchObject({ method: "getItem", params: { id: "123" } });
			expect(typeof msg.requestId).toBe("string");

			// Resolve pending request to avoid unhandled rejection on unmount
			await respond(msg.requestId as string);
		});

		it("resolves when response.success is true", async () => {
			const result = renderIpc();
			const req = defineRequest<void, { value: number }>("getValue");

			let resolved: { value: number } | undefined;
			act(() => {
				void result.current.request(req).then((v) => (resolved = v));
			});

			// Simulate extension sending success response
			await respond(lastRequestId(), { value: 42 });

			expect(resolved).toEqual({ value: 42 });
		});

		it("rejects when response.success is false", async () => {
			const result = renderIpc();
			const req = defineRequest<void, string>("fail");

			let error: Error | undefined;
			act(() => {
				void result.current.request(req).catch((e) => (error = e));
			});

			// Simulate extension sending error response
			await respondError(lastRequestId(), "Bad request");

			expect(error?.message).toBe("Bad request");
		});

		it("rejects with default message when error is empty", async () => {
			const result = renderIpc();
			const req = defineRequest<void, void>("empty");

			let error: Error | undefined;
			act(() => {
				void result.current.request(req).catch((e) => (error = e));
			});

			await respondError(lastRequestId(), "");

			expect(error?.message).toBe("Request failed");
		});

		it("ignores responses with unknown requestId", async () => {
			const result = renderIpc();
			const req = defineRequest<void, number>("test");

			let resolved = false;
			act(() => {
				void result.current.request(req).then(() => (resolved = true));
			});

			// Response with wrong requestId should be ignored
			await respond("unknown-id", 1);
			expect(resolved).toBe(false);

			// Resolve the actual pending request before unmount
			await respond(lastRequestId(), 0);
		});
	});

	describe("timeout", () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it("rejects after timeout", async () => {
			const result = renderIpc({ timeoutMs: 100 });
			const req = defineRequest<void, void>("slow");

			let error: Error | undefined;
			act(() => {
				void result.current.request(req).catch((e) => (error = e));
			});

			await act(async () => {
				vi.advanceTimersByTime(100);
				await Promise.resolve();
			});

			expect(error?.message).toBe("Request timeout: slow");
		});

		it("defaults to 30 second timeout", async () => {
			const result = renderIpc();
			const req = defineRequest<void, void>("default");

			let rejected = false;
			act(() => {
				void result.current.request(req).catch(() => (rejected = true));
			});

			await act(async () => {
				vi.advanceTimersByTime(29999);
				await Promise.resolve();
			});
			expect(rejected).toBe(false);

			await act(async () => {
				vi.advanceTimersByTime(1);
				await Promise.resolve();
			});
			expect(rejected).toBe(true);
		});
	});

	describe("command", () => {
		it("sends message without requestId", () => {
			const result = renderIpc();
			const cmd = defineCommand<{ action: string }>("doAction");

			act(() => {
				result.current.command(cmd, { action: "save" });
			});

			expect(sent[0]).toMatchObject({
				method: "doAction",
				params: { action: "save" },
			});
			expect(sent[0]).not.toHaveProperty("requestId");
		});
	});

	describe("onNotification", () => {
		it("calls handler when notification is received", () => {
			const result = renderIpc();
			const notification = defineNotification<{ count: number }>("update");
			const handler = vi.fn();

			act(() => {
				result.current.onNotification(notification, handler);
			});

			notify("update", { count: 5 });

			expect(handler).toHaveBeenCalledWith({ count: 5 });
		});

		it("supports multiple handlers for same notification", () => {
			const result = renderIpc();
			const notification = defineNotification<string>("event");
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			act(() => {
				result.current.onNotification(notification, handler1);
				result.current.onNotification(notification, handler2);
			});

			notify("event", "hello");

			expect(handler1).toHaveBeenCalledWith("hello");
			expect(handler2).toHaveBeenCalledWith("hello");
		});

		it("unsubscribe stops handler from being called", () => {
			const result = renderIpc();
			const notification = defineNotification<number>("tick");
			const handler = vi.fn();

			let unsubscribe: () => void;
			act(() => {
				unsubscribe = result.current.onNotification(notification, handler);
			});

			notify("tick", 1);
			expect(handler).toHaveBeenCalledTimes(1);

			act(() => unsubscribe());

			notify("tick", 2);
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("ignores notifications for unsubscribed types", () => {
			const result = renderIpc();
			const notification = defineNotification<void>("specific");
			const handler = vi.fn();

			act(() => {
				result.current.onNotification(notification, handler);
			});

			notify("other", null);

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("cleanup", () => {
		it("rejects pending requests on unmount", async () => {
			const result = renderIpc();
			const req = defineRequest<void, void>("pending");

			let error: Error | undefined;
			act(() => {
				void result.current.request(req).catch((e) => (error = e));
			});

			await act(async () => {
				unmount();
				await Promise.resolve();
			});

			expect(error?.message).toBe("Component unmounted");
		});

		it("removes message listener on unmount", () => {
			const spy = vi.spyOn(window, "removeEventListener");
			renderIpc();

			act(() => unmount());

			expect(spy).toHaveBeenCalledWith("message", expect.any(Function));
			spy.mockRestore();
		});
	});
});
