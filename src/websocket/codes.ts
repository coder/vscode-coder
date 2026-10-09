import { HttpStatusCode } from "../api/httpStatusCode";

/**
 * WebSocket close codes (RFC 6455) and the HTTP handshake statuses that end
 * socket reconnection.
 * @see https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1
 */

/** WebSocket close codes defined in RFC 6455 */
export const WebSocketCloseCode = {
	/** Normal closure - connection successfully completed */
	NORMAL: 1000,
	/** Endpoint going away (server shutdown) */
	GOING_AWAY: 1001,
	/** Protocol error - connection cannot be recovered */
	PROTOCOL_ERROR: 1002,
	/** Unsupported data type received - connection cannot be recovered */
	UNSUPPORTED_DATA: 1003,
	/** Abnormal closure - connection closed without close frame (network issues) */
	ABNORMAL: 1006,
} as const;

/**
 * WebSocket close codes indicating unrecoverable errors.
 * These appear in close events and should stop reconnection attempts.
 */
export const UNRECOVERABLE_WS_CLOSE_CODES = new Set<number>([
	WebSocketCloseCode.PROTOCOL_ERROR,
	WebSocketCloseCode.UNSUPPORTED_DATA,
]);

/**
 * HTTP status codes indicating unrecoverable errors during handshake.
 * These appear during socket creation and should stop reconnection attempts.
 */
export const UNRECOVERABLE_HTTP_CODES = new Set<number>([
	HttpStatusCode.UNAUTHORIZED,
	HttpStatusCode.FORBIDDEN,
	HttpStatusCode.NOT_FOUND,
	HttpStatusCode.GONE,
	HttpStatusCode.UPGRADE_REQUIRED,
]);

export class HandshakeError extends Error {
	constructor(
		readonly statusCode: number,
		message = `HTTP handshake failed (${statusCode})`,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "HandshakeError";
	}
}

/** HTTP status from a failed `ws` or `eventsource` handshake, or `undefined`. */
export function handshakeStatus(error: unknown): number | undefined {
	return error instanceof HandshakeError ? error.statusCode : undefined;
}
