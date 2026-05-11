import { randomBytes } from "node:crypto";

// OTel-format ids: lowercase hex, no separators. Keeps a future OTel
// exporter a 1:1 mapping.

/** OTel `trace_id`: 16 bytes / 32 hex. */
export function newTraceId(): string {
	return randomBytes(16).toString("hex");
}

/** OTel `span_id` (used as `event_id`): 8 bytes / 16 hex. */
export function newSpanId(): string {
	return randomBytes(8).toString("hex");
}

/** Our own session id (16 bytes / 32 hex). Avoids `vscode.env.sessionId`,
 * which is a UUID concatenated with a timestamp. */
export function newSessionId(): string {
	return randomBytes(16).toString("hex");
}
