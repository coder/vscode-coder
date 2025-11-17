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

// 403 Forbidden, 410 Gone, 426 Upgrade Required, 1002/1003 Protocol errors
const UNRECOVERABLE_CLOSE_CODES = new Set([403, 410, 426, 1002, 1003]);

// Custom close code for intentional reconnection (4000-4999 range is for private use)
const CLOSE_CODE_RECONNECTING = 4000;

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

	private constructor(
		socketFactory: SocketFactory<TData>,
		logger: Logger,
		apiRoute: string,
		options: ReconnectingWebSocketOptions = {},
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
	}

	static async create<TData>(
		socketFactory: SocketFactory<TData>,
		logger: Logger,
		apiRoute: string,
		options: ReconnectingWebSocketOptions = {},
	): Promise<ReconnectingWebSocket<TData>> {
		const instance = new ReconnectingWebSocket<TData>(
			socketFactory,
			logger,
			apiRoute,
			options,
		);
		await instance.#connect();
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

		if (this.#currentSocket) {
			this.#currentSocket.addEventListener(event, callback);
		}
	}

	removeEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void {
		(this.#eventHandlers[event] as Set<EventHandler<TData, TEvent>>).delete(
			callback,
		);

		if (this.#currentSocket) {
			this.#currentSocket.removeEventListener(event, callback);
		}
	}

	close(code?: number, reason?: string): void {
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
	}

	reconnect(): void {
		if (this.#isDisposed) {
			return;
		}

		if (this.#reconnectTimeoutId !== null) {
			clearTimeout(this.#reconnectTimeoutId);
			this.#reconnectTimeoutId = null;
		}

		if (this.#currentSocket) {
			this.#currentSocket.close(CLOSE_CODE_RECONNECTING, "Reconnecting");
		}
	}

	async #connect(): Promise<void> {
		if (this.#isDisposed || this.#isConnecting) {
			return;
		}

		this.#isConnecting = true;
		try {
			const socket = await this.#socketFactory();
			this.#currentSocket = socket;

			socket.addEventListener("open", () => {
				this.#backoffMs = this.#options.initialBackoffMs;
			});

			for (const handler of this.#eventHandlers.open) {
				socket.addEventListener("open", handler);
			}

			for (const handler of this.#eventHandlers.message) {
				socket.addEventListener("message", handler);
			}

			for (const handler of this.#eventHandlers.error) {
				socket.addEventListener("error", handler);
			}

			socket.addEventListener("close", (event) => {
				for (const handler of this.#eventHandlers.close) {
					handler(event);
				}

				if (this.#isDisposed) {
					return;
				}

				if (UNRECOVERABLE_CLOSE_CODES.has(event.code)) {
					this.#logger.error(
						`[ReconnectingWebSocket] Unrecoverable error (${event.code}) for ${this.#apiRoute}`,
					);
					this.#isDisposed = true;
					return;
				}

				// Reconnect if this was an intentional close for reconnection
				if (event.code === CLOSE_CODE_RECONNECTING) {
					this.#scheduleReconnect();
					return;
				}

				// Don't reconnect on normal closure
				if (event.code === 1000 || event.code === 1001) {
					return;
				}

				// Reconnect on abnormal closures (e.g., 1006) or other unexpected codes
				this.#scheduleReconnect();
			});
		} finally {
			this.#isConnecting = false;
		}
	}

	#scheduleReconnect(): void {
		if (this.#isDisposed || this.#reconnectTimeoutId !== null) {
			return;
		}

		const jitter =
			this.#backoffMs * this.#options.jitterFactor * (Math.random() * 2 - 1);
		const delayMs = Math.max(0, this.#backoffMs + jitter);

		this.#logger.debug(
			`[ReconnectingWebSocket] Reconnecting in ${Math.round(delayMs)}ms for ${this.#apiRoute}`,
		);

		this.#reconnectTimeoutId = setTimeout(() => {
			this.#reconnectTimeoutId = null;
			// Errors already handled in #connect
			this.#connect().catch((error) => {
				if (!this.#isDisposed) {
					this.#logger.warn(
						`[ReconnectingWebSocket] Failed: ${error instanceof Error ? error.message : String(error)} for ${this.#apiRoute}`,
					);
					this.#scheduleReconnect();
				}
			});
		}, delayMs);

		this.#backoffMs = Math.min(this.#backoffMs * 2, this.#options.maxBackoffMs);
	}

	isDisposed(): boolean {
		return this.#isDisposed;
	}
}
