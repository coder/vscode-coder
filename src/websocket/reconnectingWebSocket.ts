import {
	WebSocketCloseCode,
	NORMAL_CLOSURE_CODES,
	UNRECOVERABLE_WS_CLOSE_CODES,
	UNRECOVERABLE_HTTP_CODES,
} from "./codes";

import type { WebSocketEventType } from "coder/site/src/utils/OneWayWebSocket";

import type { Logger } from "../logging/logger";

import type {
	EventHandler,
	UnidirectionalStream,
} from "./eventStreamConnection";

export type SocketFactory<TData> = () => Promise<UnidirectionalStream<TData>>;

export type ReconnectingWebSocketOptions = {
	initialBackoffMs?: number;
	maxBackoffMs?: number;
	jitterFactor?: number;
};

export class ReconnectingWebSocket<TData = unknown>
	implements UnidirectionalStream<TData>
{
	readonly #socketFactory: SocketFactory<TData>;
	readonly #logger: Logger;
	readonly #options: Required<ReconnectingWebSocketOptions>;
	readonly #eventHandlers: {
		[K in WebSocketEventType]: Set<EventHandler<TData, K>>;
	} = {
		open: new Set<EventHandler<TData, "open">>(),
		close: new Set<EventHandler<TData, "close">>(),
		error: new Set<EventHandler<TData, "error">>(),
		message: new Set<EventHandler<TData, "message">>(),
	};

	#currentSocket: UnidirectionalStream<TData> | null = null;
	#lastRoute = "unknown"; // Cached route for logging when socket is closed
	#backoffMs: number;
	#reconnectTimeoutId: NodeJS.Timeout | null = null;
	#isDisconnected = false; // Temporary pause, can be resumed via reconnect()
	#isDisposed = false; // Permanent disposal, cannot be resumed
	#isConnecting = false;
	#pendingReconnect = false;
	readonly #onDispose?: () => void;

	private constructor(
		socketFactory: SocketFactory<TData>,
		logger: Logger,
		options: ReconnectingWebSocketOptions = {},
		onDispose?: () => void,
	) {
		this.#socketFactory = socketFactory;
		this.#logger = logger;
		this.#options = {
			initialBackoffMs: options.initialBackoffMs ?? 250,
			maxBackoffMs: options.maxBackoffMs ?? 30000,
			jitterFactor: options.jitterFactor ?? 0.1,
		};
		this.#backoffMs = this.#options.initialBackoffMs;
		this.#onDispose = onDispose;
	}

	static async create<TData>(
		socketFactory: SocketFactory<TData>,
		logger: Logger,
		options: ReconnectingWebSocketOptions = {},
		onDispose?: () => void,
	): Promise<ReconnectingWebSocket<TData>> {
		const instance = new ReconnectingWebSocket<TData>(
			socketFactory,
			logger,
			options,
			onDispose,
		);
		await instance.connect();
		return instance;
	}

	get url(): string {
		return this.#currentSocket?.url ?? "";
	}

	/**
	 * Extract the route (pathname + search) from the current socket URL for logging.
	 * Falls back to the last known route when the socket is closed.
	 */
	get #route(): string {
		const socketUrl = this.#currentSocket?.url;
		if (!socketUrl) {
			return this.#lastRoute;
		}
		const url = new URL(socketUrl);
		return url.pathname + url.search;
	}

	addEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void {
		this.#eventHandlers[event].add(callback);
	}

	removeEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void {
		this.#eventHandlers[event].delete(callback);
	}

	/**
	 * Force an immediate reconnection attempt.
	 * Resumes the socket if previously disconnected via disconnect().
	 */
	reconnect(): void {
		if (this.#isDisconnected) {
			this.#isDisconnected = false;
			this.#backoffMs = this.#options.initialBackoffMs;
		}

		if (this.#isDisposed) {
			return;
		}

		if (this.#reconnectTimeoutId !== null) {
			clearTimeout(this.#reconnectTimeoutId);
			this.#reconnectTimeoutId = null;
		}

		// If already connecting, schedule reconnect after current attempt
		if (this.#isConnecting) {
			this.#pendingReconnect = true;
			return;
		}

		// connect() will close any existing socket
		this.connect().catch((error) => this.handleConnectionError(error));
	}

	/**
	 * Temporarily disconnect the socket. Can be resumed via reconnect().
	 */
	disconnect(code?: number, reason?: string): void {
		if (this.#isDisposed || this.#isDisconnected) {
			return;
		}

		this.#isDisconnected = true;
		this.clearCurrentSocket(code, reason);
	}

	close(code?: number, reason?: string): void {
		if (this.#isDisposed) {
			return;
		}

		// Fire close handlers synchronously before disposing
		if (this.#currentSocket) {
			this.executeHandlers("close", {
				code: code ?? WebSocketCloseCode.NORMAL,
				reason: reason ?? "Normal closure",
				wasClean: true,
			});
		}

		this.dispose(code, reason);
	}

	private async connect(): Promise<void> {
		if (this.#isDisposed || this.#isDisconnected || this.#isConnecting) {
			return;
		}

		this.#isConnecting = true;
		try {
			// Close any existing socket before creating a new one
			if (this.#currentSocket) {
				this.#currentSocket.close(
					WebSocketCloseCode.NORMAL,
					"Replacing connection",
				);
				this.#currentSocket = null;
			}

			const socket = await this.#socketFactory();

			// Check if disconnected/disposed while waiting for factory
			if (this.#isDisposed || this.#isDisconnected) {
				socket.close(WebSocketCloseCode.NORMAL, "Cancelled during connection");
				return;
			}

			this.#currentSocket = socket;
			this.#lastRoute = this.#route;

			socket.addEventListener("open", (event) => {
				this.#backoffMs = this.#options.initialBackoffMs;
				this.executeHandlers("open", event);
			});

			socket.addEventListener("message", (event) => {
				this.executeHandlers("message", event);
			});

			socket.addEventListener("error", (event) => {
				this.executeHandlers("error", event);

				// Check for unrecoverable HTTP errors in the error event
				// HTTP errors during handshake fire 'error' then 'close' with 1006
				// We need to suspend here to prevent infinite reconnect loops
				const errorMessage = event.error?.message ?? event.message ?? "";
				if (this.isUnrecoverableHttpError(errorMessage)) {
					this.#logger.error(
						`Unrecoverable HTTP error for ${this.#route}: ${errorMessage}`,
					);
					this.disconnect();
				}
			});

			socket.addEventListener("close", (event) => {
				if (this.#isDisposed || this.#isDisconnected) {
					return;
				}

				this.executeHandlers("close", event);

				if (UNRECOVERABLE_WS_CLOSE_CODES.has(event.code)) {
					this.#logger.error(
						`WebSocket connection closed with unrecoverable error code ${event.code}`,
					);
					// Suspend instead of dispose - allows recovery when credentials change
					this.disconnect();
					return;
				}

				// Don't reconnect on normal closure
				if (NORMAL_CLOSURE_CODES.has(event.code)) {
					return;
				}

				// Reconnect on abnormal closures (e.g., 1006) or other unexpected codes
				this.scheduleReconnect();
			});
		} finally {
			this.#isConnecting = false;

			if (this.#pendingReconnect) {
				this.#pendingReconnect = false;
				this.reconnect();
			}
		}
	}

	private scheduleReconnect(): void {
		if (
			this.#isDisposed ||
			this.#isDisconnected ||
			this.#reconnectTimeoutId !== null
		) {
			return;
		}

		const jitter =
			this.#backoffMs * this.#options.jitterFactor * (Math.random() * 2 - 1);
		const delayMs = Math.max(0, this.#backoffMs + jitter);

		this.#logger.debug(
			`Reconnecting WebSocket in ${Math.round(delayMs)}ms for ${this.#route}`,
		);

		this.#reconnectTimeoutId = setTimeout(() => {
			this.#reconnectTimeoutId = null;
			this.connect().catch((error) => this.handleConnectionError(error));
		}, delayMs);

		this.#backoffMs = Math.min(this.#backoffMs * 2, this.#options.maxBackoffMs);
	}

	private executeHandlers<TEvent extends WebSocketEventType>(
		event: TEvent,
		eventData: Parameters<EventHandler<TData, TEvent>>[0],
	): void {
		for (const handler of this.#eventHandlers[event]) {
			try {
				handler(eventData);
			} catch (error) {
				this.#logger.error(
					`Error in ${event} handler for ${this.#route}`,
					error,
				);
			}
		}
	}

	/**
	 * Checks if the error is unrecoverable and suspends the connection,
	 * otherwise schedules a reconnect.
	 */
	private handleConnectionError(error: unknown): void {
		if (this.#isDisposed || this.#isDisconnected) {
			return;
		}

		if (this.isUnrecoverableHttpError(error)) {
			this.#logger.error(
				`Unrecoverable HTTP error during connection for ${this.#route}`,
				error,
			);
			this.disconnect();
			return;
		}

		this.#logger.warn(`WebSocket connection failed for ${this.#route}`, error);
		this.scheduleReconnect();
	}

	/**
	 * Check if an error message contains an unrecoverable HTTP status code.
	 */
	private isUnrecoverableHttpError(error: unknown): boolean {
		const message = (error as { message?: string }).message || String(error);
		for (const code of UNRECOVERABLE_HTTP_CODES) {
			if (message.includes(String(code))) {
				return true;
			}
		}
		return false;
	}

	private dispose(code?: number, reason?: string): void {
		if (this.#isDisposed) {
			return;
		}

		this.#isDisposed = true;
		this.clearCurrentSocket(code, reason);

		for (const set of Object.values(this.#eventHandlers)) {
			set.clear();
		}

		this.#onDispose?.();
	}

	private clearCurrentSocket(code?: number, reason?: string): void {
		// Clear pending reconnect to prevent resume
		this.#pendingReconnect = false;

		if (this.#reconnectTimeoutId !== null) {
			clearTimeout(this.#reconnectTimeoutId);
			this.#reconnectTimeoutId = null;
		}

		if (this.#currentSocket) {
			this.#currentSocket.close(code, reason);
			this.#currentSocket = null;
		}
	}
}
