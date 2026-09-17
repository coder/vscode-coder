import type { RawData } from "ws";

/**
 * Converts params to a query string. Returns empty string if no params,
 * otherwise returns params prefixed with '?'.
 */
export function getQueryString(
	params: Record<string, string> | URLSearchParams | undefined,
): string {
	if (!params) {
		return "";
	}
	const searchParams =
		params instanceof URLSearchParams ? params : new URLSearchParams(params);
	const str = searchParams.toString();
	return str ? `?${str}` : "";
}

export function rawDataToString(data: RawData): string {
	if (Buffer.isBuffer(data)) {
		return data.toString("utf8");
	} else if (data instanceof ArrayBuffer) {
		return new TextDecoder().decode(data);
	} else if (Array.isArray(data)) {
		return Buffer.concat(data).toString("utf8");
	} else {
		return new TextDecoder().decode(data);
	}
}

/**
 * Parses the HTTP status carried by a failed WebSocket or SSE handshake.
 *
 * `ws` rejects with `Unexpected server response: <code>` and `eventsource`
 * with `Non-200 status code (<code>)`. Matching the phrase before the digits
 * keeps a host/port such as `127.0.0.1:4040` from masquerading as a status
 * code.
 */
const HANDSHAKE_STATUS =
	/(?:unexpected server response:|non-200 status code \()\s*(\d{3})/i;

/** HTTP status from a failed `ws` or `eventsource` handshake, or `undefined`. */
export function handshakeStatus(error: unknown): number | undefined {
	const message = (error as { message?: string }).message || String(error);
	const match = HANDSHAKE_STATUS.exec(message);
	return match ? Number(match[1]) : undefined;
}
