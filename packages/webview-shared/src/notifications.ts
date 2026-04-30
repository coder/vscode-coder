import type { NotificationDef } from "@repo/shared";

/** Subscribe to an extension notification. Returns an unsubscribe function. */
export function subscribeNotification<D>(
	def: NotificationDef<D>,
	callback: (data: D) => void,
): () => void {
	const handler = (event: MessageEvent) => {
		const msg = event.data as { type?: string; data?: D } | undefined;
		if (!msg || typeof msg !== "object") {
			return;
		}
		if (msg.type !== def.method || msg.data === undefined) {
			return;
		}
		callback(msg.data);
	};
	window.addEventListener("message", handler);
	return () => window.removeEventListener("message", handler);
}
