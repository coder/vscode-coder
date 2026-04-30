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
 * Exhaustively subscribe to every notification on `api`. Compile error
 * if any notification lacks a handler. Returns a single unsubscribe.
 */
export function subscribeNotifications<
	Api extends Record<string, { kind: string; method: string }>,
>(api: Api, handlers: NotificationHandlerMap<Api>): () => void;
export function subscribeNotifications(
	api: Record<string, { kind: string; method: string }>,
	handlers: Record<string, (data: unknown) => void>,
): () => void {
	const byMethod = new Map<string, (data: unknown) => void>();
	for (const [key, def] of Object.entries(api)) {
		if (def.kind === "notification") {
			byMethod.set(def.method, handlers[key]);
		}
	}
	const handler = (event: MessageEvent<unknown>) => {
		const msg = event.data;
		if (typeof msg !== "object" || msg === null) {
			return;
		}
		const cb = byMethod.get((msg as { type?: string }).type ?? "");
		cb?.((msg as { data: unknown }).data);
	};
	window.addEventListener("message", handler);
	return () => window.removeEventListener("message", handler);
}

/**
 * Single-notification subscribe. React's `useIpc` uses this for
 * `apiHook.on<Name>`. Vanilla webviews should use `subscribeNotifications`.
 */
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
