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

import { toError } from "../error/errorUtils";

import {
	type UnidirectionalStream,
	type EventHandler,
} from "./eventStreamConnection";
import { getQueryString, rawDataToString } from "./utils";

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
		} else {
			// For other events, cast and add directly
			this.#socket.on(event, callback);
		}
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
		} else {
			this.#socket.off(event, callback);
		}
	}

	close(code?: number, reason?: string): void {
		this.#socket.close(code, reason);
	}
}
