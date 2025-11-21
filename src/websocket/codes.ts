/**
 * WebSocket close codes (RFC 6455) and HTTP status codes for socket connections.
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

/** HTTP status codes used for socket creation and connection logic */
export const HttpStatusCode = {
	/** Authentication or permission denied */
	FORBIDDEN: 403,
	/** Endpoint not found */
	NOT_FOUND: 404,
	/** Resource permanently gone */
	GONE: 410,
	/** Protocol upgrade required */
	UPGRADE_REQUIRED: 426,
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
	HttpStatusCode.FORBIDDEN,
	HttpStatusCode.GONE,
	HttpStatusCode.UPGRADE_REQUIRED,
]);

/** Close codes indicating intentional closure - do not reconnect */
export const NORMAL_CLOSURE_CODES = new Set<number>([
	WebSocketCloseCode.NORMAL,
	WebSocketCloseCode.GOING_AWAY,
]);
