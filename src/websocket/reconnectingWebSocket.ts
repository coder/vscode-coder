import type { WebSocketEventType } from "coder/site/src/utils/OneWayWebSocket";
import type { CloseEvent } from "ws";

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

// 403 Forbidden, 410 Gone, 426 Upgrade Required, 1002/1003 Protocol errors
const UNRECOVERABLE_CLOSE_CODES = new Set([403, 410, 426, 1002, 1003]);

export class ReconnectingWebSocket<TData = unknown>
	implements UnidirectionalStream<TData>
{
	readonly #socketFactory: SocketFactory<TData>;
	readonly #logger: Logger;
	readonly #apiRoute: string;
	readonly #options: Required<ReconnectingWebSocketOptions>;
	readonly #eventHandlers = {
		open: new Set<EventHandler<TData, "open">>(),
		close: new Set<EventHandler<TData, "close">>(),
		error: new Set<EventHandler<TData, "error">>(),
		message: new Set<EventHandler<TData, "message">>(),
	};

	#currentSocket: UnidirectionalStream<TData> | null = null;
	#backoffMs: number;
	#reconnectTimeoutId: NodeJS.Timeout | null = null;
	#isDisposed = false;
	#isConnecting = false;
	#pendingReconnect = false;
	readonly #onDispose?: () => void;

	private constructor(
		socketFactory: SocketFactory<TData>,
		logger: Logger,
		apiRoute: string,
		options: ReconnectingWebSocketOptions = {},
		onDispose?: () => void,
	) {
		this.#socketFactory = socketFactory;
		this.#logger = logger;
		this.#apiRoute = apiRoute;
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
		apiRoute: string,
		options: ReconnectingWebSocketOptions = {},
		onDispose?: () => void,
	): Promise<ReconnectingWebSocket<TData>> {
		const instance = new ReconnectingWebSocket<TData>(
			socketFactory,
			logger,
			apiRoute,
			options,
			onDispose,
		);
		await instance.connect();
		return instance;
	}

	get url(): string {
		return this.#currentSocket?.url ?? "";
	}

	addEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void {
		(this.#eventHandlers[event] as Set<EventHandler<TData, TEvent>>).add(
			callback,
		);
	}

	removeEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void {
		(this.#eventHandlers[event] as Set<EventHandler<TData, TEvent>>).delete(
			callback,
		);
	}

	reconnect(): void {
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
		this.connect().catch((error) => {
			if (!this.#isDisposed) {
				this.#logger.warn(
					`Manual reconnection failed for ${this.#apiRoute}: ${error instanceof Error ? error.message : String(error)}`,
				);
				this.scheduleReconnect();
			}
		});
	}

	close(code?: number, reason?: string): void {
		if (this.#isDisposed) {
			return;
		}

		// Fire close handlers synchronously before disposing
		if (this.#currentSocket) {
			this.executeHandlers("close", {
				code: code ?? 1000,
				reason: reason ?? "",
				wasClean: true,
				type: "close",
				target: this.#currentSocket,
			} as CloseEvent);
		}

		this.dispose(code, reason);
	}

	private async connect(): Promise<void> {
		if (this.#isDisposed || this.#isConnecting) {
			return;
		}

		this.#isConnecting = true;
		try {
			// Close any existing socket before creating a new one
			if (this.#currentSocket) {
				this.#currentSocket.close(1000, "Replacing connection");
				this.#currentSocket = null;
			}

			const socket = await this.#socketFactory();
			this.#currentSocket = socket;

			socket.addEventListener("open", (event) => {
				this.#backoffMs = this.#options.initialBackoffMs;
				this.executeHandlers("open", event);
			});

			socket.addEventListener("message", (event) => {
				this.executeHandlers("message", event);
			});

			socket.addEventListener("error", (event) => {
				this.executeHandlers("error", event);
			});

			socket.addEventListener("close", (event) => {
				if (this.#isDisposed) {
					return;
				}

				this.executeHandlers("close", event);

				if (UNRECOVERABLE_CLOSE_CODES.has(event.code)) {
					this.#logger.error(
						`WebSocket connection closed with unrecoverable error code ${event.code}`,
					);
					this.dispose();
					return;
				}

				// Don't reconnect on normal closure
				if (event.code === 1000 || event.code === 1001) {
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
		if (this.#isDisposed || this.#reconnectTimeoutId !== null) {
			return;
		}

		const jitter =
			this.#backoffMs * this.#options.jitterFactor * (Math.random() * 2 - 1);
		const delayMs = Math.max(0, this.#backoffMs + jitter);

		this.#logger.debug(
			`Reconnecting WebSocket in ${Math.round(delayMs)}ms for ${this.#apiRoute}`,
		);

		this.#reconnectTimeoutId = setTimeout(() => {
			this.#reconnectTimeoutId = null;
			this.connect().catch((error) => {
				if (!this.#isDisposed) {
					this.#logger.warn(
						`WebSocket connection failed for ${this.#apiRoute}: ${error instanceof Error ? error.message : String(error)}`,
					);
					this.scheduleReconnect();
				}
			});
		}, delayMs);

		this.#backoffMs = Math.min(this.#backoffMs * 2, this.#options.maxBackoffMs);
	}

	private executeHandlers<TEvent extends WebSocketEventType>(
		event: TEvent,
		eventData: Parameters<EventHandler<TData, TEvent>>[0],
	): void {
		const handlers = this.#eventHandlers[event] as Set<
			EventHandler<TData, TEvent>
		>;
		for (const handler of handlers) {
			try {
				handler(eventData);
			} catch (error) {
				this.#logger.error(
					`Error in ${event} handler for ${this.#apiRoute}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	private dispose(code?: number, reason?: string): void {
		if (this.#isDisposed) {
			return;
		}

		this.#isDisposed = true;

		if (this.#reconnectTimeoutId !== null) {
			clearTimeout(this.#reconnectTimeoutId);
			this.#reconnectTimeoutId = null;
		}

		if (this.#currentSocket) {
			this.#currentSocket.close(code, reason);
			this.#currentSocket = null;
		}

		for (const set of Object.values(this.#eventHandlers)) {
			set.clear();
		}

		this.#onDispose?.();
	}
}
