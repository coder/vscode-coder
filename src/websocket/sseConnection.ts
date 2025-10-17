import { type AxiosInstance } from "axios";
import { type ServerSentEvent } from "coder/site/src/api/typesGenerated";
import { type WebSocketEventType } from "coder/site/src/utils/OneWayWebSocket";
import { EventSource } from "eventsource";

import { createStreamingFetchAdapter } from "../api/streamingFetchAdapter";
import { type Logger } from "../logging/logger";

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
	optionsHeaders?: Record<string, string>;
	axiosInstance: AxiosInstance;
	logger: Logger;
};

export class SseConnection implements UnidirectionalStream<ServerSentEvent> {
	private readonly eventSource: EventSource;
	private readonly logger: Logger;
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
		this.logger = init.logger;
		this.url = this.buildUrl(init);
		this.eventSource = new EventSource(this.url, {
			fetch: createStreamingFetchAdapter(
				init.axiosInstance,
				init.optionsHeaders,
			),
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
			this.invokeCallbacks(this.callbacks.open, {} as WsEvent, "open"),
		);

		this.eventSource.addEventListener("data", (event: MessageEvent) => {
			this.invokeCallbacks(this.messageWrappers.values(), event, "message");
		});

		this.eventSource.addEventListener("error", (error: Event | ErrorEvent) => {
			this.invokeCallbacks(
				this.callbacks.error,
				this.createErrorEvent(error),
				"error",
			);

			if (this.eventSource.readyState === EventSource.CLOSED) {
				this.invokeCallbacks(
					this.callbacks.close,
					{
						code: 1006,
						reason: "Connection lost",
						wasClean: false,
					} as WsCloseEvent,
					"close",
				);
			}
		});
	}

	private invokeCallbacks<T>(
		callbacks: Iterable<(event: T) => void>,
		event: T,
		eventType: string,
	): void {
		for (const cb of callbacks) {
			try {
				cb(event);
			} catch (err) {
				this.logger.error(`Error in SSE ${eventType} callback:`, err);
			}
		}
	}

	private createErrorEvent(event: Event | ErrorEvent): WsErrorEvent {
		// Check for properties instead of instanceof to avoid browser-only ErrorEvent global
		const eventWithMessage = event as { message?: string; error?: unknown };
		const errorMessage = eventWithMessage.message || "SSE connection error";
		const error = eventWithMessage.error;

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
		this.invokeCallbacks(
			this.callbacks.close,
			{
				code: code ?? 1000,
				reason: reason ?? "Normal closure",
				wasClean: true,
			} as WsCloseEvent,
			"close",
		);

		Object.values(this.callbacks).forEach((callbackSet) => callbackSet.clear());
		this.messageWrappers.clear();
	}
}
