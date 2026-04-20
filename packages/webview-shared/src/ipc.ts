/**
 * Typed IPC helpers for vanilla-TS webviews. React webviews should use
 * `useIpc` (./react/useIpc), which adds request/response correlation.
 */

import { postMessage } from "./api";

import type { CommandDef, NotificationDef } from "@repo/shared";

/** Send a fire-and-forget command to the extension. */
export function sendCommand<P>(
	def: CommandDef<P>,
	...args: P extends void ? [] : [params: P]
): void {
	postMessage({
		method: def.method,
		params: args[0],
	});
}

/**
 * Subscribe to a typed notification from the extension. Returns an
 * unsubscribe function; call it on cleanup. Multiple subscribers are
 * invoked in registration order.
 */
export function onNotification<D>(
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
