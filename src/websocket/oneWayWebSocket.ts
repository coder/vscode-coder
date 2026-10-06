/**
 * A simplified wrapper over WebSockets using the 'ws' library that enforces
 * one-way communication and supports automatic JSON parsing of messages.
 *
 * Similar to coder/site/src/utils/OneWayWebSocket.ts but uses `ws` library
 * instead of the browser's WebSocket and also supports a custom base URL
 * instead of always deriving it from `window.location`.
 */

import { type WebSocketEventType } from "coder/site/src/utils/OneWayWebSocket";
import Ws, { type ClientOptions, type RawData } from "ws";

import { getQueryString } from "../common/url";
import { toError } from "../error/normalize";

import { HandshakeError } from "./codes";
import {
	type UnidirectionalStream,
	type EventHandler,
} from "./eventStreamConnection";

export interface OneWayWebSocketInit {
	location: { protocol: string; host: string };
	apiRoute: string;
	searchParams?: Record<string, string> | URLSearchParams;
	protocols?: string | string[];
	options?: ClientOptions;
}

export class OneWayWebSocket<
	TData = unknown,
> implements UnidirectionalStream<TData> {
	readonly #socket: Ws;
	#handshakeStatus?: number;
	readonly #errorCallbacks = new Map<
		EventHandler<TData, "error">,
		EventHandler<TData, "error">
	>();
	readonly #messageCallbacks = new Map<
		EventHandler<TData, "message">,
		(data: RawData) => void
	>();

	constructor(init: OneWayWebSocketInit) {
		const { location, apiRoute, protocols, options, searchParams } = init;

		const paramsSuffix = getQueryString(searchParams);
		const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
		const url = `${wsProtocol}//${location.host}${apiRoute}${paramsSuffix}`;

		this.#socket = new Ws(url, protocols, options);
		this.#socket.on("unexpected-response", (_request, response) => {
			this.#handshakeStatus = response.statusCode;
			// Handling this event suppresses ws's automatic handshake cleanup.
			this.#socket.terminate();
		});
	}

	get url(): string {
		return this.#socket.url;
	}

	addEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void {
		if (event === "message") {
			const messageCallback = callback as EventHandler<TData, "message">;

			if (this.#messageCallbacks.has(messageCallback)) {
				return;
			}

			const wrapped = (data: RawData): void => {
				try {
					const dataStr = rawDataToString(data);
					const message = JSON.parse(dataStr) as TData;
					messageCallback({
						sourceEvent: { data },
						parseError: undefined,
						parsedMessage: message,
					});
				} catch (err: unknown) {
					messageCallback({
						sourceEvent: { data },
						parseError: toError(err),
						parsedMessage: undefined,
					});
				}
			};

			this.#socket.on("message", wrapped);
			this.#messageCallbacks.set(messageCallback, wrapped);
			return;
		}

		if (event === "error") {
			const errorCallback = callback as EventHandler<TData, "error">;
			if (this.#errorCallbacks.has(errorCallback)) {
				return;
			}
			const wrapped: EventHandler<TData, "error"> = (event) => {
				if (this.#handshakeStatus === undefined) {
					errorCallback(event);
					return;
				}
				const error = new HandshakeError(this.#handshakeStatus, undefined, {
					cause: event.error,
				});
				errorCallback({ error, message: error.message });
			};
			this.#socket.addEventListener("error", wrapped);
			this.#errorCallbacks.set(errorCallback, wrapped);
			return;
		}

		// `ws` only exposes `.code`/`.reason` on the DOM-style CloseEvent from
		// addEventListener; the `on()` emitter passes them positionally, which
		// leaves `event.code` undefined for consumers. TypeScript cannot correlate
		// `event` with `callback` across two parameters, so a cast is needed either
		// way, and `ws` dispatches on the event name, so one cast covers both.
		this.#socket.addEventListener(
			event as "open",
			callback as EventHandler<TData, "open">,
		);
	}

	removeEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void {
		if (event === "message") {
			const messageCallback = callback as EventHandler<TData, "message">;
			const wrapper = this.#messageCallbacks.get(messageCallback);

			if (wrapper) {
				this.#socket.off("message", wrapper);
				this.#messageCallbacks.delete(messageCallback);
			}
			return;
		}

		if (event === "error") {
			const errorCallback = callback as EventHandler<TData, "error">;
			const wrapper = this.#errorCallbacks.get(errorCallback);
			if (wrapper) {
				this.#socket.removeEventListener("error", wrapper);
				this.#errorCallbacks.delete(errorCallback);
			}
			return;
		}

		this.#socket.removeEventListener(
			event as "open",
			callback as EventHandler<TData, "open">,
		);
	}

	close(code?: number, reason?: string): void {
		this.#socket.close(code, reason);
	}
}

export function rawDataToString(data: RawData): string {
	if (Buffer.isBuffer(data)) {
		return data.toString("utf8");
	} else if (data instanceof ArrayBuffer) {
		return new TextDecoder().decode(data);
	} else if (Array.isArray(data)) {
		return Buffer.concat(data).toString("utf8");
	} else {
		return new TextDecoder().decode(data);
	}
}
