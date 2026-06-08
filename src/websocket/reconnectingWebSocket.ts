import { ClientCertificateError } from "../error/clientCertificateError";
import { toError } from "../error/errorUtils";
import {
	WebSocketTelemetry,
	type ConnectionDropCause,
	type ConnectionStateReason,
} from "../instrumentation/websocket";

import {
	WebSocketCloseCode,
	NORMAL_CLOSURE_CODES,
	UNRECOVERABLE_WS_CLOSE_CODES,
	UNRECOVERABLE_HTTP_CODES,
} from "./codes";

import type { WebSocketEventType } from "coder/site/src/utils/OneWayWebSocket";

import type { Logger } from "../logging/logger";
import type { TelemetryReporter } from "../telemetry/reporter";

import type {
	CloseEvent,
	EventHandler,
	UnidirectionalStream,
} from "./eventStreamConnection";

function toCloseEventError(event: CloseEvent): Error {
	return new Error(`WebSocket closed with code ${event.code}: ${event.reason}`);
}

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
	telemetry: TelemetryReporter;
	/** Callback invoked when a refreshable certificate error is detected. Returns true if refresh succeeded. */
	onCertificateRefreshNeeded: () => Promise<boolean>;
}

export class ReconnectingWebSocket<
	TData = unknown,
> implements UnidirectionalStream<TData> {
	readonly #socketFactory: SocketFactory<TData>;
	readonly #logger: Logger;
	readonly #telemetry: WebSocketTelemetry;
	readonly #options: Required<Omit<ReconnectingWebSocketOptions, "telemetry">>;
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
	#dispatch(action: StateAction, reason: ConnectionStateReason): boolean {
		const previousState = this.#state;
		const newState = reduceState(previousState, action);
		if (newState === previousState) {
			// Allow CONNECT from CONNECTING as a "restart" operation
			if (
				action.type === "CONNECT" &&
				previousState === ConnectionState.CONNECTING
			) {
				return true;
			}
			return false;
		}
		this.#state = newState;
		this.#telemetry.stateTransition(previousState, newState, reason);
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
		this.#telemetry = new WebSocketTelemetry(options.telemetry);
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

		await instance.connect("initial_connect");
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
	 * Route (pathname only) of the current socket, for logging. The query
	 * string is dropped so connection tokens carried there never reach logs or
	 * telemetry. Falls back to the last known route when the socket is closed.
	 */
	get #route(): string {
		const socketUrl = this.#currentSocket?.url;
		if (!socketUrl) {
			return this.#lastRoute;
		}
		const url = new URL(socketUrl);
		return url.pathname;
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
		this.#reconnectInternal("manual_reconnect");
	}

	#reconnectInternal(reason: ConnectionStateReason): void {
		if (this.#state === ConnectionState.DISPOSED) {
			return;
		}

		if (this.#state !== ConnectionState.IDLE) {
			this.#telemetry.reconnectStarted(reason);
		}

		if (this.#state === ConnectionState.DISCONNECTED) {
			this.#backoffMs = this.#options.initialBackoffMs;
			this.#certRefreshAttempted = false; // User-initiated reconnect, allow retry
		}

		if (this.#reconnectTimeoutId !== null) {
			clearTimeout(this.#reconnectTimeoutId);
			this.#reconnectTimeoutId = null;
		}

		void this.connect(reason);
	}

	/**
	 * Temporarily disconnect the socket. Can be resumed via reconnect().
	 */
	public disconnect(code?: number, reason?: string): void {
		this.disconnectWithReason("disconnect", "manual_disconnect", {
			code,
			closeReason: reason,
		});
	}

	private disconnectWithReason(
		reason: ConnectionStateReason,
		cause: ConnectionDropCause,
		options: { code?: number; closeReason?: string; error?: unknown } = {},
	): void {
		if (!this.#dispatch({ type: "DISCONNECT" }, reason)) {
			return;
		}
		this.#telemetry.terminated(reason, {
			cause,
			code: options.code,
			error: options.error,
		});
		this.clearCurrentSocket(options.code, options.closeReason);
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

	private async connect(reason: ConnectionStateReason): Promise<void> {
		if (!this.#dispatch({ type: "CONNECT" }, reason)) {
			return;
		}
		this.#telemetry.connectStarted();
		try {
			if (this.#currentSocket) {
				this.#telemetry.dropped("replaced", WebSocketCloseCode.NORMAL);
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

				if (!this.#dispatch({ type: "OPEN" }, "open")) {
					return;
				}
				this.#telemetry.opened(this.#route);
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
				if (this.#currentSocket === socket) {
					this.handleSocketClose(event);
				}
			});
		} catch (error) {
			await this.handleConnectionError(error);
		}
	}

	private handleSocketClose(event: CloseEvent): void {
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
			this.disconnectWithReason("unrecoverable_close", "unrecoverable_close", {
				code: event.code,
				closeReason: event.reason,
				error: toCloseEventError(event),
			});
			return;
		}

		if (NORMAL_CLOSURE_CODES.has(event.code)) {
			this.disconnectWithReason("normal_close", "normal_close", {
				code: event.code,
				closeReason: event.reason,
			});
			return;
		}

		this.scheduleReconnect("unexpected_close", "unexpected_close", {
			code: event.code,
			error: toCloseEventError(event),
		});
	}

	private scheduleReconnect(
		reason: ConnectionStateReason,
		cause: ConnectionDropCause,
		options: { code?: number; error?: unknown } = {},
	): void {
		if (!this.#dispatch({ type: "SCHEDULE_RETRY" }, reason)) {
			return;
		}
		const jitter =
			this.#backoffMs * this.#options.jitterFactor * (Math.random() * 2 - 1);
		const delayMs = Math.max(0, this.#backoffMs + jitter);
		this.#telemetry.retrying(
			reason,
			{
				cause,
				code: options.code,
				error: options.error,
			},
			delayMs,
		);

		this.#logger.debug(
			`Reconnecting WebSocket in ${Math.round(delayMs)}ms for ${this.#route}`,
		);

		this.#reconnectTimeoutId = setTimeout(() => {
			this.#reconnectTimeoutId = null;
			void this.connect("scheduled_reconnect");
		}, delayMs);

		this.#backoffMs = Math.min(this.#backoffMs * 2, this.#options.maxBackoffMs);
	}

	/** Returns true if refresh succeeded and the caller should retry. */
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
			this.#certRefreshAttempted = true;
			this.#logger.info(
				`Client certificate error (alert ${certError.alertCode}), attempting refresh...`,
			);
			try {
				if (await this.#options.onCertificateRefreshNeeded()) {
					this.#logger.info("Certificate refresh succeeded, reconnecting...");
					return true;
				}
			} catch (refreshError) {
				this.#logger.error("Error during certificate refresh:", refreshError);
			}
		}

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
			this.disconnectWithReason("unrecoverable_http", "error", { error });
			return;
		}

		// Check for certificate error and attempt refresh if possible.
		const certError = ClientCertificateError.fromError(error);
		if (certError) {
			if (await this.handleClientCertificateError(certError)) {
				this.#reconnectInternal("certificate_refresh");
			} else {
				this.disconnectWithReason("certificate_error", "error", { error });
			}
			return;
		}

		this.#logger.warn(`WebSocket connection failed for ${this.#route}`, error);
		this.scheduleReconnect("connection_error", "error", { error });
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
		if (!this.#dispatch({ type: "DISPOSE" }, "dispose")) {
			return;
		}
		this.#telemetry.terminated("dispose", { cause: "disposed", code });
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
		this.#telemetry.reset();
	}
}
