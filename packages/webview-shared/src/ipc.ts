/** Typed IPC helpers for webviews. React layers `useIpc` for request/response. */

import { postMessage } from "./api";

import type {
	CommandDef,
	NotificationDef,
	NotificationHandlerMap,
} from "@repo/shared";

/** Send a fire-and-forget command to the extension. */
export function sendCommand<P>(
	def: CommandDef<P>,
	...args: P extends void ? [] : [params: P]
): void {
	postMessage({
		method: def.method,
		...(args.length > 0 ? { params: args[0] } : {}),
	});
}

/**
 * Build a dispatcher that routes a message to the matching notification
 * handler. Compile error if a handler is missing. Use this when composing
 * dispatch with other listener logic; otherwise use `subscribeNotifications`.
 */
export function buildNotificationRouter<
	Api extends Record<string, { kind: string; method: string }>,
>(api: Api, handlers: NotificationHandlerMap<Api>): (data: unknown) => void;
export function buildNotificationRouter(
	api: Record<string, { kind: string; method: string }>,
	handlers: Record<string, (data: unknown) => void>,
): (data: unknown) => void {
	const byMethod = new Map<string, (data: unknown) => void>();
	for (const [key, def] of Object.entries(api)) {
		if (def.kind === "notification") {
			byMethod.set(def.method, handlers[key]);
		}
	}
	return (data: unknown) => {
		if (typeof data !== "object" || data === null) {
			return;
		}
		const msg = data as { type?: string; data?: unknown };
		byMethod.get(msg.type ?? "")?.(msg.data);
	};
}

/** Subscribe to every notification on `api`. Compile error if a handler is missing. */
export function subscribeNotifications<
	Api extends Record<string, { kind: string; method: string }>,
>(api: Api, handlers: NotificationHandlerMap<Api>): () => void;
export function subscribeNotifications(
	api: Record<string, { kind: string; method: string }>,
	handlers: Record<string, (data: unknown) => void>,
): () => void {
	const route = buildNotificationRouter(api, handlers);
	const handler = (event: MessageEvent<unknown>) => route(event.data);
	window.addEventListener("message", handler);
	return () => window.removeEventListener("message", handler);
}

/** Single-notification subscribe; React's `useIpc` uses this. Vanilla webviews use `subscribeNotifications`. */
export function subscribeOne<D>(
	def: NotificationDef<D>,
	callback: (data: D) => void,
): () => void {
	const handler = (event: MessageEvent<unknown>) => {
		const msg = event.data;
		if (
			typeof msg !== "object" ||
			msg === null ||
			(msg as { type?: unknown }).type !== def.method
		) {
			return;
		}
		callback((msg as { data: D }).data);
	};
	window.addEventListener("message", handler);
	return () => window.removeEventListener("message", handler);
}
