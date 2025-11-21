import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { WebSocketCloseCode, HttpStatusCode } from "@/websocket/codes";
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
		it("automatically reconnects on abnormal closure (1006)", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();

			sockets[0].fireOpen();
			sockets[0].fireClose({
				code: WebSocketCloseCode.ABNORMAL,
				reason: "Network error",
			});

			await vi.advanceTimersByTimeAsync(300);
			expect(sockets).toHaveLength(2);

			ws.close();
		});

		it.each([
			{ code: WebSocketCloseCode.NORMAL, name: "Normal Closure" },
			{ code: WebSocketCloseCode.GOING_AWAY, name: "Going Away" },
		])(
			"does not reconnect on normal closure: $name ($code)",
			async ({ code }) => {
				const { ws, sockets } = await createReconnectingWebSocket();

				sockets[0].fireOpen();
				sockets[0].fireClose({ code, reason: "Normal" });

				await vi.advanceTimersByTimeAsync(10000);
				expect(sockets).toHaveLength(1);

				ws.close();
			},
		);

		it.each([
			WebSocketCloseCode.PROTOCOL_ERROR,
			WebSocketCloseCode.UNSUPPORTED_DATA,
		])(
			"does not reconnect on unrecoverable WebSocket close code: %i",
			async (code) => {
				const { ws, sockets } = await createReconnectingWebSocket();

				sockets[0].fireOpen();
				sockets[0].fireClose({ code, reason: "Unrecoverable" });

				await vi.advanceTimersByTimeAsync(10000);
				expect(sockets).toHaveLength(1);

				ws.close();
			},
		);

		it.each([
			HttpStatusCode.FORBIDDEN,
			HttpStatusCode.GONE,
			HttpStatusCode.UPGRADE_REQUIRED,
		])(
			"does not reconnect on unrecoverable HTTP error during creation: %i",
			async (statusCode) => {
				let socketCreationAttempts = 0;
				const factory = vi.fn(() => {
					socketCreationAttempts++;
					// Simulate HTTP error during WebSocket handshake
					return Promise.reject(
						new Error(`Unexpected server response: ${statusCode}`),
					);
				});

				await expect(
					ReconnectingWebSocket.create(
						factory,
						createMockLogger(),
						"/api/test",
					),
				).rejects.toThrow(`Unexpected server response: ${statusCode}`);

				// Should not retry after unrecoverable HTTP error
				await vi.advanceTimersByTimeAsync(10000);
				expect(socketCreationAttempts).toBe(1);
			},
		);

		it("reconnect() connects immediately and cancels pending reconnections", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();

			sockets[0].fireOpen();
			sockets[0].fireClose({
				code: WebSocketCloseCode.ABNORMAL,
				reason: "Connection lost",
			});

			// Manual reconnect() should happen immediately and cancel the scheduled reconnect
			ws.reconnect();
			expect(sockets).toHaveLength(2);

			// Verify pending reconnect was cancelled - no third socket should be created
			await vi.advanceTimersByTimeAsync(1000);
			expect(sockets).toHaveLength(2);

			ws.close();
		});

		it("queues reconnect() calls made during connection", async () => {
			const sockets: MockSocket[] = [];
			let pendingResolve: ((socket: MockSocket) => void) | null = null;

			const factory = vi.fn(() => {
				const socket = createMockSocket();
				sockets.push(socket);

				// First call resolves immediately, other calls wait for manual resolve
				if (sockets.length === 1) {
					return Promise.resolve(socket);
				} else {
					return new Promise<MockSocket>((resolve) => {
						pendingResolve = resolve;
					});
				}
			});

			const ws = await fromFactory(factory);
			sockets[0].fireOpen();
			expect(sockets).toHaveLength(1);

			// Start first reconnect (will block on factory promise)
			ws.reconnect();
			expect(sockets).toHaveLength(2);
			// Call reconnect again while first reconnect is in progress
			ws.reconnect();
			// Still only 2 sockets (queued reconnect hasn't started)
			expect(sockets).toHaveLength(2);

			// Complete the first reconnect
			pendingResolve!(sockets[1]);
			sockets[1].fireOpen();

			// Wait a tick for the queued reconnect to execute
			await Promise.resolve();
			// Now queued reconnect should have executed, creating third socket
			expect(sockets).toHaveLength(3);

			ws.close();
		});
	});

	describe("Event Handlers", () => {
		it("persists event handlers across reconnections", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			sockets[0].fireOpen();

			const handler = vi.fn();
			ws.addEventListener("message", handler);

			// First message
			sockets[0].fireMessage({ test: true });
			expect(handler).toHaveBeenCalledTimes(1);

			// Disconnect and reconnect
			sockets[0].fireClose({
				code: WebSocketCloseCode.ABNORMAL,
				reason: "Network",
			});
			await vi.advanceTimersByTimeAsync(300);
			expect(sockets).toHaveLength(2);
			sockets[1].fireOpen();

			// Handler should still work on new socket
			sockets[1].fireMessage({ test: true });
			expect(handler).toHaveBeenCalledTimes(2);

			ws.close();
		});

		it("removes event handlers when removeEventListener is called", async () => {
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

	describe("close() and Disposal", () => {
		it("stops reconnection when close() is called", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();

			sockets[0].fireOpen();
			sockets[0].fireClose({
				code: WebSocketCloseCode.ABNORMAL,
				reason: "Network",
			});
			ws.close();

			await vi.advanceTimersByTimeAsync(10000);
			expect(sockets).toHaveLength(1);
		});

		it("closes the underlying socket with provided code and reason", async () => {
			const socket = createMockSocket();
			const factory = vi.fn(() => Promise.resolve(socket));
			const ws = await fromFactory(factory);

			socket.fireOpen();
			ws.close(WebSocketCloseCode.NORMAL, "Test close");

			expect(socket.close).toHaveBeenCalledWith(
				WebSocketCloseCode.NORMAL,
				"Test close",
			);
		});

		it("calls onDispose callback once, even with multiple close() calls", async () => {
			let disposeCount = 0;
			const { ws } = await createReconnectingWebSocket(() => ++disposeCount);

			ws.close();
			ws.close();
			ws.close();

			expect(disposeCount).toBe(1);
		});

		it("calls onDispose callback on unrecoverable WebSocket close code", async () => {
			let disposeCount = 0;
			const { sockets } = await createReconnectingWebSocket(
				() => ++disposeCount,
			);

			sockets[0].fireOpen();
			sockets[0].fireClose({
				code: WebSocketCloseCode.PROTOCOL_ERROR,
				reason: "Protocol error",
			});

			expect(disposeCount).toBe(1);
		});

		it("does not call onDispose callback during reconnection", async () => {
			let disposeCount = 0;
			const { ws, sockets } = await createReconnectingWebSocket(
				() => ++disposeCount,
			);

			sockets[0].fireOpen();
			sockets[0].fireClose({
				code: WebSocketCloseCode.ABNORMAL,
				reason: "Network error",
			});

			await vi.advanceTimersByTimeAsync(300);
			expect(disposeCount).toBe(0);

			ws.close();
			expect(disposeCount).toBe(1);
		});
	});

	describe("Backoff Strategy", () => {
		it("doubles backoff delay after each failed connection", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			const socket = sockets[0];
			socket.fireOpen();

			const backoffDelays = [300, 600, 1200, 2400];

			// Fail repeatedly
			for (let i = 0; i < 4; i++) {
				const currentSocket = sockets[i];
				currentSocket.fireClose({
					code: WebSocketCloseCode.ABNORMAL,
					reason: "Fail",
				});
				const delay = backoffDelays[i];
				await vi.advanceTimersByTimeAsync(delay);
				const nextSocket = sockets[i + 1];
				nextSocket.fireOpen();
			}

			expect(sockets).toHaveLength(5);
			ws.close();
		});

		it("resets backoff delay after successful connection", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			const socket1 = sockets[0];
			socket1.fireOpen();

			// First disconnect
			socket1.fireClose({ code: WebSocketCloseCode.ABNORMAL, reason: "Fail" });
			await vi.advanceTimersByTimeAsync(300);
			const socket2 = sockets[1];
			socket2.fireOpen();

			// Second disconnect - should use initial backoff again
			socket2.fireClose({ code: WebSocketCloseCode.ABNORMAL, reason: "Fail" });
			await vi.advanceTimersByTimeAsync(300);

			expect(sockets).toHaveLength(3);
			ws.close();
		});
	});

	describe("Error Handling", () => {
		it("schedules retry when socket factory throws error", async () => {
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

			shouldFail = true;
			sockets[0].fireClose({
				code: WebSocketCloseCode.ABNORMAL,
				reason: "Network",
			});

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
					wasClean: event.code === WebSocketCloseCode.NORMAL,
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

async function createReconnectingWebSocket(onDispose?: () => void): Promise<{
	ws: ReconnectingWebSocket;
	sockets: MockSocket[];
}> {
	const sockets: MockSocket[] = [];
	const factory = vi.fn(() => {
		const socket = createMockSocket();
		sockets.push(socket);
		return Promise.resolve(socket);
	});
	const ws = await fromFactory(factory, onDispose);

	// We start with one socket
	expect(sockets).toHaveLength(1);

	return { ws, sockets };
}

async function fromFactory<T>(
	factory: SocketFactory<T>,
	onDispose?: () => void,
): Promise<ReconnectingWebSocket<T>> {
	return await ReconnectingWebSocket.create(
		factory,
		createMockLogger(),
		"/random/api",
		undefined,
		onDispose,
	);
}
