import { type AxiosInstance } from "axios";
import { type ServerSentEvent } from "coder/site/src/api/typesGenerated";
import { type WebSocketEventType } from "coder/site/src/utils/OneWayWebSocket";
import { EventSource } from "eventsource";

import { createStreamingFetchAdapter } from "../api/streamingFetchAdapter";

import { getQueryString } from "./utils";

import type {
	CloseEvent as WsCloseEvent,
	ErrorEvent as WsErrorEvent,
	Event as WsEvent,
	MessageEvent as WsMessageEvent,
} from "ws";

import type {
	UnidirectionalStream,
	ParsedMessageEvent,
	EventHandler,
} from "./eventStreamConnection";

export type SseConnectionInit = {
	location: { protocol: string; host: string };
	apiRoute: string;
	searchParams?: Record<string, string> | URLSearchParams;
	axiosInstance: AxiosInstance;
};

export class SseConnection implements UnidirectionalStream<ServerSentEvent> {
	private readonly eventSource: EventSource;
	private readonly callbacks = {
		open: new Set<EventHandler<ServerSentEvent, "open">>(),
		close: new Set<EventHandler<ServerSentEvent, "close">>(),
		error: new Set<EventHandler<ServerSentEvent, "error">>(),
	};
	// Original callback -> wrapped callback
	private readonly messageWrappers = new Map<
		EventHandler<ServerSentEvent, "message">,
		(event: MessageEvent) => void
	>();

	public readonly url: string;

	public constructor(init: SseConnectionInit) {
		this.url = this.buildUrl(init);
		this.eventSource = new EventSource(this.url, {
			fetch: createStreamingFetchAdapter(init.axiosInstance),
		});
		this.setupEventHandlers();
	}

	private buildUrl(init: SseConnectionInit): string {
		const { location, apiRoute, searchParams } = init;
		const queryString = getQueryString(searchParams);
		return `${location.protocol}//${location.host}${apiRoute}${queryString}`;
	}

	private setupEventHandlers(): void {
		this.eventSource.addEventListener("open", () =>
			this.callbacks.open.forEach((cb) => cb({} as WsEvent)),
		);

		this.eventSource.addEventListener("message", (event: MessageEvent) => {
			[...this.messageWrappers.values()].forEach((wrapper) => wrapper(event));
		});

		this.eventSource.addEventListener("error", (error: Event | ErrorEvent) => {
			this.callbacks.error.forEach((cb) => cb(this.createErrorEvent(error)));

			if (this.eventSource.readyState === EventSource.CLOSED) {
				this.callbacks.close.forEach((cb) =>
					cb({
						code: 1006,
						reason: "Connection lost",
						wasClean: false,
					} as WsCloseEvent),
				);
			}
		});
	}

	private createErrorEvent(event: Event | ErrorEvent): WsErrorEvent {
		const errorMessage =
			event instanceof ErrorEvent && event.message
				? event.message
				: "SSE connection error";
		const error = event instanceof ErrorEvent ? event.error : undefined;

		return {
			error: error,
			message: errorMessage,
		} as WsErrorEvent;
	}

	public addEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<ServerSentEvent, TEvent>,
	): void {
		switch (event) {
			case "close":
				this.callbacks.close.add(
					callback as EventHandler<ServerSentEvent, "close">,
				);
				break;
			case "error":
				this.callbacks.error.add(
					callback as EventHandler<ServerSentEvent, "error">,
				);
				break;
			case "message": {
				const messageCallback = callback as EventHandler<
					ServerSentEvent,
					"message"
				>;
				if (!this.messageWrappers.has(messageCallback)) {
					this.messageWrappers.set(messageCallback, (event: MessageEvent) => {
						messageCallback(this.parseMessage(event));
					});
				}
				break;
			}
			case "open":
				this.callbacks.open.add(
					callback as EventHandler<ServerSentEvent, "open">,
				);
				break;
		}
	}

	private parseMessage(
		event: MessageEvent,
	): ParsedMessageEvent<ServerSentEvent> {
		const wsEvent = { data: event.data } as WsMessageEvent;
		try {
			return {
				sourceEvent: wsEvent,
				parsedMessage: { type: "data", data: JSON.parse(event.data) },
				parseError: undefined,
			};
		} catch (err) {
			return {
				sourceEvent: wsEvent,
				parsedMessage: undefined,
				parseError: err as Error,
			};
		}
	}

	public removeEventListener<TEvent extends WebSocketEventType>(
		event: TEvent,
		callback: EventHandler<ServerSentEvent, TEvent>,
	): void {
		switch (event) {
			case "close":
				this.callbacks.close.delete(
					callback as EventHandler<ServerSentEvent, "close">,
				);
				break;
			case "error":
				this.callbacks.error.delete(
					callback as EventHandler<ServerSentEvent, "error">,
				);
				break;
			case "message":
				this.messageWrappers.delete(
					callback as EventHandler<ServerSentEvent, "message">,
				);
				break;
			case "open":
				this.callbacks.open.delete(
					callback as EventHandler<ServerSentEvent, "open">,
				);
				break;
		}
	}

	public close(code?: number, reason?: string): void {
		this.eventSource.close();
		this.callbacks.close.forEach((cb) =>
			cb({
				code: code ?? 1000,
				reason: reason ?? "Normal closure",
				wasClean: true,
			} as WsCloseEvent),
		);

		Object.values(this.callbacks).forEach((callbackSet) => callbackSet.clear());
		this.messageWrappers.clear();
	}
}
