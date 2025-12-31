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
