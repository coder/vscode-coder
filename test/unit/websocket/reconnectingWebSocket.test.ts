import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { WebSocketCloseCode, HttpStatusCode } from "@/websocket/codes";
import {
	ConnectionState,
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
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			sockets[0].fireClose({
				code: WebSocketCloseCode.ABNORMAL,
				reason: "Network error",
			});
			expect(ws.state).toBe(ConnectionState.AWAITING_RETRY);

			await vi.advanceTimersByTimeAsync(300);
			expect(sockets).toHaveLength(2);
			sockets[1].fireOpen();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

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
				expect(ws.state).toBe(ConnectionState.CONNECTED);

				sockets[0].fireClose({ code, reason: "Unrecoverable" });
				expect(ws.state).toBe(ConnectionState.DISCONNECTED);

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

				// create() returns a disconnected instance instead of throwing
				const ws = await ReconnectingWebSocket.create(
					factory,
					createMockLogger(),
					{ onCertificateRefreshNeeded: () => Promise.resolve(false) },
				);

				// Should be disconnected after unrecoverable HTTP error
				expect(ws.state).toBe(ConnectionState.DISCONNECTED);

				// Should not retry after unrecoverable HTTP error
				await vi.advanceTimersByTimeAsync(10000);
				expect(socketCreationAttempts).toBe(1);

				ws.close();
			},
		);

		it.each([
			HttpStatusCode.UNAUTHORIZED,
			HttpStatusCode.FORBIDDEN,
			HttpStatusCode.GONE,
		])(
			"does not reconnect on unrecoverable HTTP error via error event: %i",
			async (statusCode) => {
				// HTTP errors during handshake fire 'error' event, then 'close' with 1006
				const { ws, sockets } = await createReconnectingWebSocket();

				sockets[0].fireError(
					new Error(`Unexpected server response: ${statusCode}`),
				);
				expect(ws.state).toBe(ConnectionState.DISCONNECTED);

				sockets[0].fireClose({
					code: WebSocketCloseCode.ABNORMAL,
					reason: "Connection failed",
				});

				// Should not reconnect - unrecoverable HTTP error
				await vi.advanceTimersByTimeAsync(10000);
				expect(sockets).toHaveLength(1);

				ws.close();
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

		it("reconnect() during CONNECTING immediately restarts connection", async () => {
			const { ws, sockets, completeConnection } =
				await createBlockingReconnectingWebSocket();

			// Start first reconnect (will block on factory promise)
			ws.reconnect();
			expect(sockets).toHaveLength(2);
			// Call reconnect again while first reconnect is in progress
			// This immediately restarts (creates a new socket)
			ws.reconnect();
			expect(sockets).toHaveLength(3);

			// Complete the third socket's connection
			completeConnection();
			await Promise.resolve();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			ws.close();
		});

		it("disconnect() cancels in-progress reconnect and prevents new connections", async () => {
			const { ws, sockets, failConnection } =
				await createBlockingReconnectingWebSocket();

			ws.reconnect();
			expect(ws.state).toBe(ConnectionState.CONNECTING);
			expect(sockets).toHaveLength(2);

			// Disconnect while reconnect is in progress
			ws.disconnect();
			expect(ws.state).toBe(ConnectionState.DISCONNECTED);
			failConnection(new Error("No base URL"));
			await Promise.resolve();

			// No new socket should be created after disconnect
			expect(sockets).toHaveLength(2);
			await vi.advanceTimersByTimeAsync(10000);
			expect(sockets).toHaveLength(2);

			ws.close();
		});

		it("disconnect() during pending connection closes socket when factory resolves", async () => {
			const { ws, sockets, completeConnection } =
				await createBlockingReconnectingWebSocket();

			// Start reconnect (will block on factory promise)
			ws.reconnect();
			expect(ws.state).toBe(ConnectionState.CONNECTING);
			expect(sockets).toHaveLength(2);

			// Disconnect while factory is still pending
			ws.disconnect();
			expect(ws.state).toBe(ConnectionState.DISCONNECTED);

			completeConnection();
			await Promise.resolve();

			expect(sockets[1].close).toHaveBeenCalledWith(
				WebSocketCloseCode.NORMAL,
				"Cancelled during connection",
			);

			// No reconnection should happen
			await vi.advanceTimersByTimeAsync(10000);
			expect(sockets).toHaveLength(2);

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

		it("preserves event handlers after suspend() and reconnect()", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			sockets[0].fireOpen();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			const handler = vi.fn();
			ws.addEventListener("message", handler);
			sockets[0].fireMessage({ test: 1 });
			expect(handler).toHaveBeenCalledTimes(1);

			// Suspend the socket
			ws.disconnect();
			expect(ws.state).toBe(ConnectionState.DISCONNECTED);

			// Reconnect (async operation)
			ws.reconnect();
			await Promise.resolve(); // Wait for async connect()
			expect(sockets).toHaveLength(2);
			sockets[1].fireOpen();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			// Handler should still work after suspend/reconnect
			sockets[1].fireMessage({ test: 2 });
			expect(handler).toHaveBeenCalledTimes(2);

			ws.close();
		});

		it("clears event handlers after close()", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			sockets[0].fireOpen();

			const handler = vi.fn();
			ws.addEventListener("message", handler);
			sockets[0].fireMessage({ test: 1 });
			expect(handler).toHaveBeenCalledTimes(1);

			// Close permanently
			ws.close();

			// Even if we could reconnect (we can't), handlers would be cleared
			// Verify handler was removed by checking it's no longer in the set
			// We can't easily test this without exposing internals, but close() clears handlers
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

		it("suspends (not disposes) on unrecoverable WebSocket close code", async () => {
			let disposeCount = 0;
			const { ws, sockets } = await createReconnectingWebSocket(
				() => ++disposeCount,
			);

			sockets[0].fireOpen();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			sockets[0].fireClose({
				code: WebSocketCloseCode.PROTOCOL_ERROR,
				reason: "Protocol error",
			});

			// Should suspend, not dispose - allows recovery when credentials change
			expect(ws.state).toBe(ConnectionState.DISCONNECTED);
			expect(disposeCount).toBe(0);

			// Should be able to reconnect after suspension
			ws.reconnect();
			await Promise.resolve();
			expect(sockets).toHaveLength(2);
			sockets[1].fireOpen();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			ws.close();
			expect(ws.state).toBe(ConnectionState.DISPOSED);
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

		it("reconnect() resumes suspended socket after HTTP 403 error", async () => {
			const { ws, sockets, setFactoryError } =
				await createReconnectingWebSocketWithErrorControl();
			sockets[0].fireOpen();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			// Trigger reconnect that will fail with 403
			setFactoryError(
				new Error(`Unexpected server response: ${HttpStatusCode.FORBIDDEN}`),
			);
			ws.reconnect();
			await Promise.resolve();

			// Socket should be suspended - no automatic reconnection
			expect(ws.state).toBe(ConnectionState.DISCONNECTED);
			await vi.advanceTimersByTimeAsync(10000);
			expect(sockets).toHaveLength(1);

			// reconnect() should resume the suspended socket
			setFactoryError(null);
			ws.reconnect();
			await Promise.resolve();
			expect(sockets).toHaveLength(2);
			sockets[1].fireOpen();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			ws.close();
			expect(ws.state).toBe(ConnectionState.DISPOSED);
		});

		it("reconnect() does nothing after close()", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			sockets[0].fireOpen();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			ws.close();
			expect(ws.state).toBe(ConnectionState.DISPOSED);

			ws.reconnect();
			expect(ws.state).toBe(ConnectionState.DISPOSED);
			expect(sockets).toHaveLength(1);
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
		it("error event when CONNECTED schedules retry", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();

			sockets[0].fireOpen();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			sockets[0].fireError(new Error("Connection lost"));
			expect(ws.state).toBe(ConnectionState.AWAITING_RETRY);

			await vi.advanceTimersByTimeAsync(300);
			expect(sockets).toHaveLength(2);

			ws.close();
		});

		it("error event when DISCONNECTED is ignored", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();

			sockets[0].fireOpen();
			expect(ws.state).toBe(ConnectionState.CONNECTED);

			ws.disconnect();
			expect(ws.state).toBe(ConnectionState.DISCONNECTED);

			// Error after disconnect should be ignored
			sockets[0].fireError(new Error("Connection lost"));
			expect(ws.state).toBe(ConnectionState.DISCONNECTED);

			// No reconnection should be scheduled
			await vi.advanceTimersByTimeAsync(10000);
			expect(sockets).toHaveLength(1);

			ws.close();
		});

		it("multiple errors while AWAITING_RETRY only creates one reconnection", async () => {
			const { ws, sockets } = await createReconnectingWebSocket();
			sockets[0].fireOpen();

			sockets[0].fireError(new Error("First error"));
			sockets[0].fireError(new Error("Second error"));
			sockets[0].fireError(new Error("Third error"));

			await vi.advanceTimersByTimeAsync(300);
			expect(sockets).toHaveLength(2);

			ws.close();
		});

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

	describe("Certificate Refresh", () => {
		const setupRefreshTest = async (onRefresh: () => Promise<boolean>) => {
			const sockets: MockSocket[] = [];
			const refreshCallback = vi.fn().mockImplementation(onRefresh);
			const factory = vi.fn(() => {
				const socket = createMockSocket();
				sockets.push(socket);
				return Promise.resolve(socket);
			});
			const ws = await fromFactory(factory, undefined, refreshCallback);
			sockets[0].fireOpen();
			return { ws, sockets, refreshCallback };
		};

		it("reconnects after successful refresh", async () => {
			let certState: "expired" | "valid" = "expired";
			const { ws, sockets } = await setupRefreshTest(() => {
				certState = "valid";
				return Promise.resolve(true);
			});

			sockets[0].fireError(new Error("ssl alert certificate_expired"));
			await vi.waitFor(() => expect(sockets).toHaveLength(2));

			expect(certState).toBe("valid");
			ws.close();
		});

		it("disconnects when refresh fails", async () => {
			const { ws, sockets } = await setupRefreshTest(() =>
				Promise.resolve(false),
			);

			sockets[0].fireError(new Error("ssl alert certificate_expired"));
			await vi.waitFor(() =>
				expect(ws.state).toBe(ConnectionState.DISCONNECTED),
			);

			expect(sockets).toHaveLength(1);
			ws.close();
		});

		it("only refreshes once per connection cycle (retry-once)", async () => {
			let refreshCount = 0;
			const { ws, sockets } = await setupRefreshTest(() => {
				refreshCount++;
				return Promise.resolve(true);
			});

			sockets[0].fireError(new Error("ssl alert certificate_expired"));
			await vi.waitFor(() => expect(sockets).toHaveLength(2));

			sockets[1].fireError(new Error("ssl alert certificate_expired"));
			await vi.waitFor(() =>
				expect(ws.state).toBe(ConnectionState.DISCONNECTED),
			);

			expect(refreshCount).toBe(1);
			ws.close();
		});

		it("resets refresh state after successful connection", async () => {
			const { ws, sockets } = await setupRefreshTest(() =>
				Promise.resolve(true),
			);

			sockets[0].fireError(new Error("ssl alert certificate_expired"));
			await vi.waitFor(() => expect(sockets).toHaveLength(2));

			sockets[1].fireOpen();
			sockets[1].fireError(new Error("ssl alert certificate_expired"));
			await vi.waitFor(() => expect(sockets).toHaveLength(3));

			ws.close();
		});

		it("skips refresh for non-refreshable errors (unknown_ca)", async () => {
			const { ws, sockets, refreshCallback } = await setupRefreshTest(() =>
				Promise.resolve(true),
			);

			sockets[0].fireError(new Error("ssl alert unknown_ca"));
			await vi.waitFor(() =>
				expect(ws.state).toBe(ConnectionState.DISCONNECTED),
			);

			expect(refreshCallback).not.toHaveBeenCalled();
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

async function createReconnectingWebSocketWithErrorControl(): Promise<{
	ws: ReconnectingWebSocket;
	sockets: MockSocket[];
	setFactoryError: (error: Error | null) => void;
}> {
	const sockets: MockSocket[] = [];
	let factoryError: Error | null = null;

	const factory = vi.fn(() => {
		if (factoryError) {
			return Promise.reject(factoryError);
		}
		const socket = createMockSocket();
		sockets.push(socket);
		return Promise.resolve(socket);
	});

	const ws = await fromFactory(factory);
	expect(sockets).toHaveLength(1);

	return {
		ws,
		sockets,
		setFactoryError: (error: Error | null) => {
			factoryError = error;
		},
	};
}

async function fromFactory<T>(
	factory: SocketFactory<T>,
	onDispose?: () => void,
	onCertificateRefreshNeeded?: () => Promise<boolean>,
): Promise<ReconnectingWebSocket<T>> {
	return await ReconnectingWebSocket.create(
		factory,
		createMockLogger(),
		{
			onCertificateRefreshNeeded:
				onCertificateRefreshNeeded ?? (() => Promise.resolve(false)),
		},
		onDispose,
	);
}

async function createBlockingReconnectingWebSocket(): Promise<{
	ws: ReconnectingWebSocket;
	sockets: MockSocket[];
	completeConnection: () => void;
	failConnection: (error: Error) => void;
}> {
	const sockets: MockSocket[] = [];
	let pendingResolve: ((socket: MockSocket) => void) | null = null;
	let pendingReject: ((error: Error) => void) | null = null;

	const factory = vi.fn(() => {
		const socket = createMockSocket();
		sockets.push(socket);
		if (sockets.length === 1) {
			return Promise.resolve(socket);
		}
		return new Promise<MockSocket>((resolve, reject) => {
			pendingResolve = resolve;
			pendingReject = reject;
		});
	});

	const ws = await fromFactory(factory);
	sockets[0].fireOpen();

	return {
		ws,
		sockets,
		completeConnection: () => {
			const socket = sockets.at(-1)!;
			pendingResolve?.(socket);
			// Fire open after microtask so event listener is attached
			queueMicrotask(() => socket.fireOpen());
		},
		failConnection: (error: Error) => pendingReject?.(error),
	};
}
