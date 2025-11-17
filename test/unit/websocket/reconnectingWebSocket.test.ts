import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
	ReconnectingWebSocket,
	type SocketFactory,
} from "@/websocket/reconnectingWebSocket";

import { createMockLogger } from "../../mocks/testHelpers";

import type { CloseEvent, Event as WsEvent } from "ws";

import type { UnidirectionalStream } from "@/websocket/eventStreamConnection";

describe("ReconnectingWebSocket", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe("Reconnection Logic", () => {
		it("reconnects on abnormal closure (1006)", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();

			sockets[0].fireOpen();
			sockets[0].fireClose({ code: 1006, reason: "Network error" });

			// Should schedule reconnect
			await vi.advanceTimersByTimeAsync(300);
			expect(sockets).toHaveLength(2);

			ws.close();
		});

		it.each([
			{ code: 1000, name: "Normal Closure" },
			{ code: 1001, name: "Going Away" },
		])("does NOT reconnect on $name ($code)", async ({ code }) => {
			const { ws, sockets } = await createReconnectingWebSocket();

			sockets[0].fireOpen();
			sockets[0].fireClose({ code, reason: "Normal" });

			// Should NOT reconnect
			await vi.advanceTimersByTimeAsync(10000);
			expect(sockets).toHaveLength(1);

			ws.close();
		});

		it.each([403, 410, 426, 1002, 1003])(
			"does NOT reconnect on unrecoverable error (%i)",
			async (code) => {
				const { ws, sockets } = await createReconnectingWebSocket();

				sockets[0].fireOpen();
				sockets[0].fireClose({ code, reason: "Unrecoverable" });

				// Should NOT reconnect
				await vi.advanceTimersByTimeAsync(10000);
				expect(sockets).toHaveLength(1);

				ws.close();
			},
		);

		it("reconnects when manually calling reconnect()", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();

			sockets[0].fireOpen();
			// Manually trigger reconnection
			ws.reconnect();
			sockets[0].fireClose({ code: 4000, reason: "Reconnecting" });

			// Should reconnect
			await vi.advanceTimersByTimeAsync(300);
			expect(sockets).toHaveLength(2);

			ws.close();
		});
	});

	describe("Listener Persistence", () => {
		it("keeps listeners subscribed across reconnections", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			sockets[0].fireOpen();

			const handler = vi.fn();
			ws.addEventListener("message", handler);

			// First message
			sockets[0].fireMessage({ test: true });
			expect(handler).toHaveBeenCalledTimes(1);

			// Disconnect and reconnect
			sockets[0].fireClose({ code: 1006, reason: "Network" });
			await vi.advanceTimersByTimeAsync(300);
			expect(sockets).toHaveLength(2);
			sockets[1].fireOpen();

			// Handler should still work on new socket
			sockets[1].fireMessage({ test: true });
			expect(handler).toHaveBeenCalledTimes(2);

			ws.close();
		});

		it("properly removes listeners", async () => {
			const socket = createMockSocket();
			const factory = vi.fn(() => Promise.resolve(socket));

			const ws = await fromFactory(factory);
			socket.fireOpen();

			const handler1 = vi.fn();
			const handler2 = vi.fn();

			ws.addEventListener("message", handler1);
			ws.addEventListener("message", handler2);
			ws.removeEventListener("message", handler1);

			socket.fireMessage({ test: true });

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).toHaveBeenCalledTimes(1);

			ws.close();
		});
	});

	describe("Disposal", () => {
		it("stops reconnection when disposed", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			const socket = sockets[0];
			socket.fireOpen();

			// Close and immediately dispose
			socket.fireClose({ code: 1006, reason: "Network" });
			ws.close();

			// Should NOT reconnect
			await vi.advanceTimersByTimeAsync(10000);
			expect(sockets).toHaveLength(1);
		});

		it("closes the underlying socket", async () => {
			const socket = createMockSocket();
			const factory = vi.fn(() => Promise.resolve(socket));
			const ws = await fromFactory(factory);

			socket.fireOpen();

			ws.close(1000, "Test close");
			expect(socket.close).toHaveBeenCalledWith(1000, "Test close");
		});
	});

	describe("Exponential Backoff", () => {
		it("increases backoff exponentially on repeated failures", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			const socket = sockets[0];
			socket.fireOpen();

			const backoffDelays = [300, 600, 1200, 2400];

			// Fail repeatedly
			for (let i = 0; i < 4; i++) {
				const currentSocket = sockets[i];
				currentSocket.fireClose({ code: 1006, reason: "Fail" });
				const delay = backoffDelays[i];
				await vi.advanceTimersByTimeAsync(delay);
				const nextSocket = sockets[i + 1];
				nextSocket.fireOpen();
			}

			expect(sockets).toHaveLength(5);
			ws.close();
		});

		it("resets backoff after successful connection", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			const socket1 = sockets[0];
			socket1.fireOpen();

			// First disconnect
			socket1.fireClose({ code: 1006, reason: "Fail" });
			await vi.advanceTimersByTimeAsync(300);
			const socket2 = sockets[1];
			socket2.fireOpen();

			// Second disconnect - should use initial backoff again
			socket2.fireClose({ code: 1006, reason: "Fail" });
			await vi.advanceTimersByTimeAsync(300);

			expect(sockets).toHaveLength(3);
			ws.close();
		});
	});

	describe("Edge Cases", () => {
		it("handles disposal during reconnection delay", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();

			sockets[0].fireOpen();
			sockets[0].fireClose({ code: 1006, reason: "Network" });

			// Dispose while waiting for reconnect
			await vi.advanceTimersByTimeAsync(100);
			ws.close();

			// Should not reconnect
			await vi.advanceTimersByTimeAsync(10000);
			expect(sockets).toHaveLength(1);
		});

		it("prevents concurrent reconnect attempts", async () => {
			const socket = createMockSocket();
			const factory = vi.fn(() => Promise.resolve(socket));
			const ws = await fromFactory(factory);

			socket.fireOpen();

			// Call reconnect multiple times rapidly
			ws.reconnect();
			ws.reconnect();
			ws.reconnect();
			socket.fireClose({ code: 4000, reason: "Reconnecting" });

			await vi.advanceTimersByTimeAsync(300);

			// Should only trigger one reconnection
			expect(factory).toHaveBeenCalledTimes(2);

			ws.close();
		});

		it("handles errors during socket factory", async () => {
			const sockets: MockSocket[] = [];
			let shouldFail = false;
			const factory = vi.fn(() => {
				if (shouldFail) {
					return Promise.reject(new Error("Factory failed"));
				}
				const socket = createMockSocket();
				sockets.push(socket);
				return Promise.resolve(socket);
			});
			const ws = await fromFactory(factory);

			sockets[0].fireOpen();

			// Make factory fail
			shouldFail = true;
			sockets[0].fireClose({ code: 1006, reason: "Network" });

			// Should schedule retry
			await vi.advanceTimersByTimeAsync(300);
			expect(sockets).toHaveLength(1);

			ws.close();
		});
	});
});

type MockSocket = UnidirectionalStream<unknown> & {
	fireOpen: () => void;
	fireClose: (event: { code: number; reason: string }) => void;
	fireMessage: (data: unknown) => void;
	fireError: (error: Error) => void;
};

function createMockSocket(): MockSocket {
	const listeners: {
		open: Set<(event: WsEvent) => void>;
		close: Set<(event: CloseEvent) => void>;
		error: Set<(event: { error?: Error; message?: string }) => void>;
		message: Set<(event: unknown) => void>;
	} = {
		open: new Set(),
		close: new Set(),
		error: new Set(),
		message: new Set(),
	};

	return {
		url: "ws://test.example.com/api/test",
		addEventListener: vi.fn(
			(event: keyof typeof listeners, callback: unknown) => {
				(listeners[event] as Set<(data: unknown) => void>).add(
					callback as (data: unknown) => void,
				);
			},
		),
		removeEventListener: vi.fn(
			(event: keyof typeof listeners, callback: unknown) => {
				(listeners[event] as Set<(data: unknown) => void>).delete(
					callback as (data: unknown) => void,
				);
			},
		),
		close: vi.fn(),
		fireOpen: () => {
			for (const cb of listeners.open) {
				cb({} as WsEvent);
			}
		},
		fireClose: (event: { code: number; reason: string }) => {
			for (const cb of listeners.close) {
				cb({
					code: event.code,
					reason: event.reason,
					wasClean: false,
				} as CloseEvent);
			}
		},
		fireMessage: (data: unknown) => {
			for (const cb of listeners.message) {
				cb({
					sourceEvent: { data },
					parsedMessage: data,
					parseError: undefined,
				});
			}
		},
		fireError: (error: Error) => {
			for (const cb of listeners.error) {
				cb({ error, message: error.message });
			}
		},
	};
}

async function createReconnectingWebSocket(): Promise<{
	ws: ReconnectingWebSocket;
	sockets: MockSocket[];
}> {
	const sockets: MockSocket[] = [];
	const factory = vi.fn(() => {
		const socket = createMockSocket();
		sockets.push(socket);
		return Promise.resolve(socket);
	});
	const ws = await fromFactory(factory);

	// We start with one socket
	expect(sockets).toHaveLength(1);

	return { ws, sockets };
}

async function fromFactory<T>(
	factory: SocketFactory<T>,
): Promise<ReconnectingWebSocket<T>> {
	return await ReconnectingWebSocket.create(
		factory,
		createMockLogger(),
		"/random/api",
	);
}
