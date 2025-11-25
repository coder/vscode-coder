import { type WebSocketEventType } from "coder/site/src/utils/OneWayWebSocket";
import {
	type CloseEvent as WsCloseEvent,
	type Event as WsEvent,
	type ErrorEvent as WsErrorEvent,
	type MessageEvent as WsMessageEvent,
} from "ws";

export type Event = Omit<WsEvent, "type" | "target">;
export type CloseEvent = Omit<WsCloseEvent, "type" | "target">;
export type ErrorEvent = Omit<WsErrorEvent, "type" | "target">;
export type MessageEvent = Omit<WsMessageEvent, "type" | "target">;

// Event payload types matching OneWayWebSocket
export type ParsedMessageEvent<TData> = Readonly<
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

export type EventPayloadMap<TData> = {
	close: CloseEvent;
	error: ErrorEvent;
	message: ParsedMessageEvent<TData>;
	open: Event;
};

export type EventHandler<TData, TEvent extends WebSocketEventType> = (
	payload: EventPayloadMap<TData>[TEvent],
) => void;

/**
 * Common interface for both WebSocket and SSE connections that handle event streams.
 * Matches the OneWayWebSocket interface for compatibility.
 */
export interface UnidirectionalStream<TData> {
	readonly url: string;
	addEventListener<TEvent extends WebSocketEventType>(
		eventType: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void;

	removeEventListener<TEvent extends WebSocketEventType>(
		eventType: TEvent,
		callback: EventHandler<TData, TEvent>,
	): void;

	close(code?: number, reason?: string): void;
}
