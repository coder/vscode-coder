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
import type { TelemetryReporter } from "../telemetry/reporter";

import type {
	CloseEvent,
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

type ReconnectMeasurements = Record<"attempts" | "totalDurationMs", number>;

interface ReconnectTelemetryCycle {
	readonly startMs: number;
	readonly measurements: ReconnectMeasurements;
	readonly resolve: () => void;
	readonly reject: (error: Error) => void;
	attempts: number;
	completed: boolean;
}

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
	telemetry?: TelemetryReporter;
	/** Callback invoked when a refreshable certificate error is detected. Returns true if refresh succeeded. */
	onCertificateRefreshNeeded: () => Promise<boolean>;
}

export class ReconnectingWebSocket<
	TData = unknown,
> implements UnidirectionalStream<TData> {
	readonly #socketFactory: SocketFactory<TData>;
	readonly #logger: Logger;
	readonly #telemetry: TelemetryReporter | undefined;
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
	#connectionOpenedAtMs: number | undefined;
	#connectionDropped = false;
	#reconnectCycle: ReconnectTelemetryCycle | undefined;
	readonly #onDispose?: () => void;

	/**
	 * Dispatch an action to transition state. Returns true if transition is allowed.
	 */
	#dispatch(action: StateAction, reason: string): boolean {
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
		this.#telemetry?.log("connection.state_transition", {
			from: previousState,
			to: newState,
			reason,
		});
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
		this.#telemetry = options.telemetry;
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

		if (this.#state !== ConnectionState.IDLE) {
			this.startReconnectTelemetry("manual_reconnect");
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
		void this.connect("manual_reconnect");
	}

	/**
	 * Temporarily disconnect the socket. Can be resumed via reconnect().
	 */
	public disconnect(code?: number, reason?: string): void {
		this.disconnectWithReason("disconnect", code, reason);
	}

	private disconnectWithReason(
		telemetryReason: string,
		code?: number,
		reason?: string,
	): void {
		if (!this.#dispatch({ type: "DISCONNECT" }, telemetryReason)) {
			return;
		}
		this.emitConnectionDrop("manual_disconnect", code);
		this.finishReconnectTelemetry(
			false,
			new Error(`WebSocket disconnected: ${telemetryReason}`),
		);
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

	private async connect(reason: string): Promise<void> {
		const connectStartedAtMs = performance.now();
		if (!this.#dispatch({ type: "CONNECT" }, reason)) {
			return;
		}
		this.recordReconnectAttempt();
		try {
			// Close any existing socket before creating a new one
			if (this.#currentSocket) {
				this.emitConnectionDrop("replaced", WebSocketCloseCode.NORMAL);
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
				const openedAtMs = performance.now();
				this.#connectionOpenedAtMs = openedAtMs;
				this.#connectionDropped = false;
				this.#telemetry?.log(
					"connection.open",
					{ url: this.#route },
					{ connectDurationMs: openedAtMs - connectStartedAtMs },
				);
				this.finishReconnectTelemetry(true);
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
					const error = closeEventError(event);
					this.emitConnectionDrop("unrecoverable_close", event.code, error);
					this.#logger.error(
						`WebSocket connection closed with unrecoverable error code ${event.code}`,
					);
					this.disconnectWithReason(
						"unrecoverable_close",
						event.code,
						event.reason,
					);
					return;
				}

				if (NORMAL_CLOSURE_CODES.has(event.code)) {
					this.emitConnectionDrop("normal_close", event.code);
					return;
				}

				this.emitConnectionDrop(
					"unexpected_close",
					event.code,
					closeEventError(event),
				);
				this.scheduleReconnect("unexpected_close");
			});
		} catch (error) {
			await this.handleConnectionError(error);
		}
	}

	private scheduleReconnect(reason: string): void {
		if (!this.#dispatch({ type: "SCHEDULE_RETRY" }, reason)) {
			return;
		}
		this.startReconnectTelemetry(reason);

		const jitter =
			this.#backoffMs * this.#options.jitterFactor * (Math.random() * 2 - 1);
		const delayMs = Math.max(0, this.#backoffMs + jitter);

		this.#logger.debug(
			`Reconnecting WebSocket in ${Math.round(delayMs)}ms for ${this.#route}`,
		);

		this.#reconnectTimeoutId = setTimeout(() => {
			this.#reconnectTimeoutId = null;
			// connect() handles all errors internally
			void this.connect("scheduled_reconnect");
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
			this.emitConnectionDrop("error", undefined, error);
			this.disconnectWithReason("unrecoverable_http");
			return;
		}

		// Check for certificate error and attempt refresh if possible.
		const certError = ClientCertificateError.fromError(error);
		if (certError) {
			if (await this.handleClientCertificateError(certError)) {
				this.reconnect();
			} else {
				this.emitConnectionDrop("error", undefined, error);
				this.disconnectWithReason("certificate_error");
			}
			return;
		}

		this.#logger.warn(`WebSocket connection failed for ${this.#route}`, error);
		this.emitConnectionDrop("error", undefined, error);
		this.scheduleReconnect("connection_error");
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
		this.emitConnectionDrop("disposed", code);
		this.finishReconnectTelemetry(
			false,
			new Error("WebSocket disposed before reconnect completed"),
		);
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
		this.#connectionOpenedAtMs = undefined;
		this.#connectionDropped = false;
	}

	private emitConnectionDrop(
		cause: string,
		closeCode?: number,
		error?: unknown,
	): void {
		if (this.#connectionOpenedAtMs === undefined || this.#connectionDropped) {
			return;
		}

		const properties = {
			cause,
			closeCode: closeCode === undefined ? "" : String(closeCode),
		};
		const measurements = {
			connectionDurationMs: performance.now() - this.#connectionOpenedAtMs,
		};
		if (error === undefined) {
			this.#telemetry?.log("connection.drop", properties, measurements);
		} else {
			this.#telemetry?.logError(
				"connection.drop",
				error,
				properties,
				measurements,
			);
		}
		this.#connectionDropped = true;
	}

	private startReconnectTelemetry(reason: string): void {
		if (!this.#telemetry || this.#reconnectCycle) {
			return;
		}

		const measurements: ReconnectMeasurements = {
			attempts: 0,
			totalDurationMs: 0,
		};
		let resolveCycle!: () => void;
		let rejectCycle!: (error: Error) => void;
		const cycleDone = new Promise<void>((resolve, reject) => {
			resolveCycle = resolve;
			rejectCycle = reject;
		});

		const startMs = performance.now();
		this.#reconnectCycle = {
			startMs,
			measurements,
			resolve: resolveCycle,
			reject: rejectCycle,
			attempts: 0,
			completed: false,
		};
		void this.#telemetry
			.trace("connection.reconnect", () => cycleDone, { reason }, measurements)
			.catch(() => undefined);
	}

	private recordReconnectAttempt(): void {
		const cycle = this.#reconnectCycle;
		if (!cycle) {
			return;
		}
		cycle.attempts += 1;
		cycle.measurements.attempts = cycle.attempts;
		cycle.measurements.totalDurationMs = performance.now() - cycle.startMs;
	}

	private finishReconnectTelemetry(success: boolean, error?: Error): void {
		const cycle = this.#reconnectCycle;
		if (!cycle || cycle.completed) {
			return;
		}

		cycle.completed = true;
		cycle.measurements.totalDurationMs = performance.now() - cycle.startMs;
		this.#reconnectCycle = undefined;
		if (success) {
			cycle.resolve();
		} else {
			cycle.reject(error ?? new Error("WebSocket reconnect failed"));
		}
	}
}

function closeEventError(event: CloseEvent): Error {
	return new Error(
		`WebSocket closed unexpectedly with code ${event.code}: ${event.reason}`,
	);
}
