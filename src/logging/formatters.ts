import type { InternalAxiosRequestConfig } from "axios";
import prettyBytes from "pretty-bytes";

const SENSITIVE_HEADERS = ["Coder-Session-Token", "Proxy-Authorization"];

export function formatTime(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	if (ms < 60000) {
		return `${(ms / 1000).toFixed(2)}s`;
	}
	if (ms < 3600000) {
		return `${(ms / 60000).toFixed(2)}m`;
	}
	return `${(ms / 3600000).toFixed(2)}h`;
}

export function formatMethod(method: string | undefined): string {
	return (method ?? "GET").toUpperCase();
}

/**
 * Formats content-length for display. Returns the header value if available,
 * otherwise estimates size by serializing the data body (prefixed with ~).
 */
export function formatContentLength(
	headers: Record<string, unknown>,
	data: unknown,
): string {
	const len = headers["content-length"];
	if (len && typeof len === "string") {
		const bytes = parseInt(len, 10);
		return isNaN(bytes) ? "(?b)" : `(${prettyBytes(bytes)})`;
	}

	// Estimate from data if no header
	if (data !== undefined && data !== null) {
		const estimated = Buffer.byteLength(JSON.stringify(data), "utf8");
		return `(~${prettyBytes(estimated)})`;
	}

	return `(${prettyBytes(0)})`;
}

export function formatUri(
	config: InternalAxiosRequestConfig | undefined,
): string {
	return config?.url || "<no url>";
}

export function formatHeaders(headers: Record<string, unknown>): string {
	const formattedHeaders = Object.entries(headers)
		.map(([key, value]) => {
			if (SENSITIVE_HEADERS.includes(key)) {
				return `${key}: <redacted>`;
			}
			return `${key}: ${value}`;
		})
		.join("\n")
		.trim();

	return formattedHeaders.length > 0 ? formattedHeaders : "<no headers>";
}

export function formatBody(body: unknown): string {
	if (body) {
		return JSON.stringify(body);
	} else {
		return "<no body>";
	}
}
