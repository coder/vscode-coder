/**
 * A simplified wrapper over WebSockets using the 'ws' library that enforces
 * one-way communication and supports automatic JSON parsing of messages.
 *
 * Similar to coder/site/src/utils/OneWayWebSocket.ts but uses `ws` library
 * instead of the browser's WebSocket and also supports a custom base URL
 * instead of always deriving it from `window.location`.
 */

import { type WebSocketEventType } from "coder/site/src/utils/OneWayWebSocket";
import Ws, {
	type ClientOptions,
	type CloseEvent,
	type ErrorEvent,
	type Event,
	type MessageEvent,
	type RawData,
} from "ws";

export type OneWayMessageEvent<TData> = Readonly<
	| {
			sourceEvent: MessageEvent;
			parsedMessage: TData;
			parseError: undefined;
	  }
	| {
			sourceEvent: MessageEvent;
			parsedMessage: undefined;
			parseError: Error;
	  }
>;

type OneWayEventPayloadMap<TData> = {
	close: CloseEvent;
	error: ErrorEvent;
	message: OneWayMessageEvent<TData>;
	open: Event;
};

type OneWayEventCallback<TData, TEvent extends WebSocketEventType> = (
	payload: OneWayEventPayloadMap<TData>[TEvent],
) => void;

interface OneWayWebSocketApi<TData> {
	get url(): string;
	addEventListener<TEvent extends WebSocketEventType>(
		eventType: TEvent,
		callback: OneWayEventCallback<TData, TEvent>,
	): void;
	removeEventListener<TEvent extends WebSocketEventType>(
		eventType: TEvent,
		callback: OneWayEventCallback<TData, TEvent>,
	): void;
	close(code?: number, reason?: string): void;
}

export type OneWayWebSocketInit = {
	location: { protocol: string; host: string };
	apiRoute: string;
	searchParams?: Record<string, string> | URLSearchParams;
	protocols?: string | string[];
	options?: ClientOptions;
};

export class OneWayWebSocket<TData = unknown>
	implements OneWayWebSocketApi<TData>
{
	readonly #socket: Ws;
	readonly #messageCallbacks = new Map<
		OneWayEventCallback<TData, "message">,
		(data: RawData) => void
	>();

	constructor(init: OneWayWebSocketInit) {
		const { location, apiRoute, protocols, options, searchParams } = init;

		const formattedParams =
			searchParams instanceof URLSearchParams
				? searchParams
				: new URLSearchParams(searchParams);
		const paramsString = formattedParams.toString();
		const paramsSuffix = paramsString ? `?${paramsString}` : "";
		const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
		const url = `${wsProtocol}//${location.host}${apiRoute}${paramsSuffix}`;

		this.#socket = new Ws(url, protocols, options);
	}

	get url(): string {
		return this.#socket.url;
	}

	addEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: OneWayEventCallback<TData, TEvent>,
	): void {
		if (event === "message") {
			const messageCallback = callback as OneWayEventCallback<TData, "message">;

			if (this.#messageCallbacks.has(messageCallback)) {
				return;
			}

			const wrapped = (data: RawData): void => {
				try {
					const message = JSON.parse(data.toString()) as TData;
					messageCallback({
						sourceEvent: { data } as MessageEvent,
						parseError: undefined,
						parsedMessage: message,
					});
				} catch (err) {
					messageCallback({
						sourceEvent: { data } as MessageEvent,
						parseError: err as Error,
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
		callback: OneWayEventCallback<TData, TEvent>,
	): void {
		if (event === "message") {
			const messageCallback = callback as OneWayEventCallback<TData, "message">;
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
