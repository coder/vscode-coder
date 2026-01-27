import { ClientCertificateError } from "../error/clientCertificateError";
import { toError } from "../error/errorUtils";

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

/**
 * Connection states for the ReconnectingWebSocket state machine.
 */
export enum ConnectionState {
	/** Initial state, ready to connect */
	IDLE = "IDLE",
	/** Actively running connect() - WS factory in progress */
	CONNECTING = "CONNECTING",
	/** Socket is open and working */
	CONNECTED = "CONNECTED",
	/** Waiting for backoff timer before attempting reconnection */
	AWAITING_RETRY = "AWAITING_RETRY",
	/** Temporarily paused - user must call reconnect() to resume */
	DISCONNECTED = "DISCONNECTED",
	/** Permanently closed - cannot be reused */
	DISPOSED = "DISPOSED",
}

/**
 * Actions that trigger state transitions.
 */
type StateAction =
	| { readonly type: "CONNECT" }
	| { readonly type: "OPEN" }
	| { readonly type: "SCHEDULE_RETRY" }
	| { readonly type: "DISCONNECT" }
	| { readonly type: "DISPOSE" };

/**
 * Pure reducer function for state transitions.
 */
function reduceState(
	state: ConnectionState,
	action: StateAction,
): ConnectionState {
	switch (action.type) {
		case "CONNECT":
			switch (state) {
				case ConnectionState.IDLE:
				case ConnectionState.CONNECTED:
				case ConnectionState.AWAITING_RETRY:
				case ConnectionState.DISCONNECTED:
					return ConnectionState.CONNECTING;
				default:
					return state;
			}

		case "OPEN":
			switch (state) {
				case ConnectionState.CONNECTING:
					return ConnectionState.CONNECTED;
				default:
					return state;
			}

		case "SCHEDULE_RETRY":
			switch (state) {
				case ConnectionState.CONNECTING:
				case ConnectionState.CONNECTED:
					return ConnectionState.AWAITING_RETRY;
				default:
					return state;
			}

		case "DISCONNECT":
			switch (state) {
				case ConnectionState.IDLE:
				case ConnectionState.CONNECTING:
				case ConnectionState.CONNECTED:
				case ConnectionState.AWAITING_RETRY:
					return ConnectionState.DISCONNECTED;
				default:
					return state;
			}

		case "DISPOSE":
			return ConnectionState.DISPOSED;
	}
}

export type SocketFactory<TData> = () => Promise<UnidirectionalStream<TData>>;

export interface ReconnectingWebSocketOptions {
	initialBackoffMs?: number;
	maxBackoffMs?: number;
	jitterFactor?: number;
	/** Callback invoked when a refreshable certificate error is detected. Returns true if refresh succeeded. */
	onCertificateRefreshNeeded: () => Promise<boolean>;
}

export class ReconnectingWebSocket<
	TData = unknown,
> implements UnidirectionalStream<TData> {
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
	#state: ConnectionState = ConnectionState.IDLE;
	#certRefreshAttempted = false; // Tracks if cert refresh was already attempted this connection cycle
	readonly #onDispose?: () => void;

	/**
	 * Dispatch an action to transition state. Returns true if transition is allowed.
	 */
	#dispatch(action: StateAction): boolean {
		const newState = reduceState(this.#state, action);
		if (newState === this.#state) {
			// Allow CONNECT from CONNECTING as a "restart" operation
			if (
				action.type === "CONNECT" &&
				this.#state === ConnectionState.CONNECTING
			) {
				return true;
			}
			return false;
		}
		this.#state = newState;
		return true;
	}

	private constructor(
		socketFactory: SocketFactory<TData>,
		logger: Logger,
		options: ReconnectingWebSocketOptions,
		onDispose?: () => void,
	) {
		this.#socketFactory = socketFactory;
		this.#logger = logger;
		this.#options = {
			initialBackoffMs: options.initialBackoffMs ?? 250,
			maxBackoffMs: options.maxBackoffMs ?? 30000,
			jitterFactor: options.jitterFactor ?? 0.1,
			onCertificateRefreshNeeded: options.onCertificateRefreshNeeded,
		};
		this.#backoffMs = this.#options.initialBackoffMs;
		this.#onDispose = onDispose;
	}

	public static async create<TData>(
		socketFactory: SocketFactory<TData>,
		logger: Logger,
		options: ReconnectingWebSocketOptions,
		onDispose?: () => void,
	): Promise<ReconnectingWebSocket<TData>> {
		const instance = new ReconnectingWebSocket<TData>(
			socketFactory,
			logger,
			options,
			onDispose,
		);

		// connect() handles all errors internally
		await instance.connect();
		return instance;
	}

	public get url(): string {
		return this.#currentSocket?.url ?? "";
	}

	/**
	 * Returns the current connection state.
	 */
	public get state(): ConnectionState {
		return this.#state;
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

	public addEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void {
		this.#eventHandlers[event].add(callback);
	}

	public removeEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void {
		this.#eventHandlers[event].delete(callback);
	}

	/**
	 * Force an immediate reconnection attempt.
	 * Resumes the socket if previously disconnected via disconnect().
	 */
	public reconnect(): void {
		if (this.#state === ConnectionState.DISPOSED) {
			return;
		}

		if (this.#state === ConnectionState.DISCONNECTED) {
			this.#backoffMs = this.#options.initialBackoffMs;
			this.#certRefreshAttempted = false; // User-initiated reconnect, allow retry
		}

		if (this.#reconnectTimeoutId !== null) {
			clearTimeout(this.#reconnectTimeoutId);
			this.#reconnectTimeoutId = null;
		}

		// connect() handles all errors internally
		void this.connect();
	}

	/**
	 * Temporarily disconnect the socket. Can be resumed via reconnect().
	 */
	public disconnect(code?: number, reason?: string): void {
		if (!this.#dispatch({ type: "DISCONNECT" })) {
			return;
		}
		this.clearCurrentSocket(code, reason);
	}

	public close(code?: number, reason?: string): void {
		if (this.#state === ConnectionState.DISPOSED) {
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
		if (!this.#dispatch({ type: "CONNECT" })) {
			return;
		}
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

			// Check if state changed while waiting for factory (e.g., disconnect/dispose called)
			if (this.#state !== ConnectionState.CONNECTING) {
				socket.close(WebSocketCloseCode.NORMAL, "Cancelled during connection");
				return;
			}

			this.#currentSocket = socket;
			this.#lastRoute = this.#route;

			socket.addEventListener("open", (event) => {
				if (this.#currentSocket !== socket) {
					return;
				}

				if (!this.#dispatch({ type: "OPEN" })) {
					return;
				}
				// Reset backoff on successful connection
				this.#backoffMs = this.#options.initialBackoffMs;
				this.#certRefreshAttempted = false;
				this.executeHandlers("open", event);
			});

			socket.addEventListener("message", (event) => {
				if (this.#currentSocket !== socket) {
					return;
				}

				this.executeHandlers("message", event);
			});

			socket.addEventListener("error", (event) => {
				if (this.#currentSocket !== socket) {
					return;
				}

				this.executeHandlers("error", event);
				// Errors during initial connection are caught by the factory (waitForOpen).
				// This handler is for errors AFTER successful connection.
				// Route through handleConnectionError for consistent handling.
				const error = toError(event.error, event.message);
				void this.handleConnectionError(error);
			});

			socket.addEventListener("close", (event) => {
				if (this.#currentSocket !== socket) {
					return;
				}

				if (
					this.#state === ConnectionState.DISPOSED ||
					this.#state === ConnectionState.DISCONNECTED
				) {
					return;
				}

				this.executeHandlers("close", event);

				if (UNRECOVERABLE_WS_CLOSE_CODES.has(event.code)) {
					this.#logger.error(
						`WebSocket connection closed with unrecoverable error code ${event.code}`,
					);
					this.disconnect();
					return;
				}

				if (NORMAL_CLOSURE_CODES.has(event.code)) {
					return;
				}

				this.scheduleReconnect();
			});
		} catch (error) {
			await this.handleConnectionError(error);
		}
	}

	private scheduleReconnect(): void {
		if (!this.#dispatch({ type: "SCHEDULE_RETRY" })) {
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
			// connect() handles all errors internally
			void this.connect();
		}, delayMs);

		this.#backoffMs = Math.min(this.#backoffMs * 2, this.#options.maxBackoffMs);
	}

	/**
	 * Attempt to refresh certificates and return true if refresh succeeded.
	 */
	private async attemptCertificateRefresh(): Promise<boolean> {
		try {
			return await this.#options.onCertificateRefreshNeeded();
		} catch (refreshError) {
			this.#logger.error("Error during certificate refresh:", refreshError);
			return false;
		}
	}

	/**
	 * Handle client certificate errors by attempting refresh for refreshable errors.
	 * @returns true if refresh succeeded.
	 */
	private async handleClientCertificateError(
		certError: ClientCertificateError,
	): Promise<boolean> {
		// Only attempt refresh once per connection cycle
		if (this.#certRefreshAttempted) {
			this.#logger.warn("Certificate refresh already attempted, not retrying");
			void certError.showNotification();
			return false;
		}

		if (certError.isRefreshable) {
			this.#certRefreshAttempted = true; // Mark that we're attempting
			this.#logger.info(
				`Client certificate error (alert ${certError.alertCode}), attempting refresh...`,
			);
			if (await this.attemptCertificateRefresh()) {
				this.#logger.info("Certificate refresh succeeded, reconnecting...");
				return true;
			}
		}

		// Show notification for failed/non-refreshable errors
		void certError.showNotification();
		return false;
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
	private async handleConnectionError(error: unknown): Promise<void> {
		if (
			this.#state === ConnectionState.DISPOSED ||
			this.#state === ConnectionState.DISCONNECTED
		) {
			this.#logger.debug(
				`Ignoring connection error in ${this.#state} state for ${this.#route}`,
				error,
			);
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

		// Check for certificate error and attempt refresh if possible.
		const certError = ClientCertificateError.fromError(error);
		if (certError) {
			if (await this.handleClientCertificateError(certError)) {
				this.reconnect();
			} else {
				this.disconnect();
			}
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
		if (!this.#dispatch({ type: "DISPOSE" })) {
			return;
		}
		this.clearCurrentSocket(code, reason);

		for (const set of Object.values(this.#eventHandlers)) {
			set.clear();
		}

		this.#onDispose?.();
	}

	private clearCurrentSocket(code?: number, reason?: string): void {
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
