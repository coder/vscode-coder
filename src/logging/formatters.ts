import prettyBytes from "pretty-bytes";

import type { InternalAxiosRequestConfig } from "axios";

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
		return isNaN(bytes) ? "(?B)" : `(${prettyBytes(bytes)})`;
	}

	// Estimate from data if no header

	if (data === undefined || data === null) {
		return `(${prettyBytes(0)})`;
	}

	if (Buffer.isBuffer(data)) {
		return `(${prettyBytes(data.byteLength)})`;
	}
	if (typeof data === "string" || typeof data === "bigint") {
		const bytes = Buffer.byteLength(data.toString(), "utf8");
		return `(${prettyBytes(bytes)})`;
	}
	if (typeof data === "number" || typeof data === "boolean") {
		return `(~${prettyBytes(8)})`;
	}

	if (typeof data === "object") {
		const stringified = safeStringify(data);
		if (stringified !== null) {
			const bytes = Buffer.byteLength(stringified, "utf8");
			return `(~${prettyBytes(bytes)})`;
		}
	}

	return "(?B)";
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
		return safeStringify(body) ?? "<invalid body>";
	} else {
		return "<no body>";
	}
}

function safeStringify(data: unknown): string | null {
	try {
		const seen = new WeakSet();
		return JSON.stringify(data, (_key, value) => {
			// Handle circular references
			if (typeof value === "object" && value !== null) {
				if (seen.has(value)) {
					return "[Circular]";
				}
				seen.add(value);
			}

			// Handle special types that might slip through
			if (typeof value === "function") {
				return "[Function]";
			}
			if (typeof value === "symbol") {
				return "[Symbol]";
			}
			if (typeof value === "bigint") {
				return value.toString();
			}

			return value;
		});
	} catch {
		return null;
	}
}
