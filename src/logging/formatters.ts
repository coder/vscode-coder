import util from "node:util";
import prettyBytes from "pretty-bytes";

import { sizeOf } from "./utils";

import type { AxiosRequestConfig } from "axios";

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
	return (method ? method : "GET").toUpperCase();
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
		return isNaN(bytes) ? "(? B)" : `(${prettyBytes(bytes)})`;
	}

	// Estimate from data if no header
	const size = sizeOf(data);
	if (size !== undefined) {
		return `(${prettyBytes(size)})`;
	}

	if (typeof data === "object") {
		const stringified = safeStringify(data);
		if (stringified !== null) {
			const bytes = Buffer.byteLength(stringified, "utf8");
			return `(~${prettyBytes(bytes)})`;
		}
	}

	return "(? B)";
}

export function formatUri(config: AxiosRequestConfig | undefined): string {
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
		return util.inspect(data, {
			showHidden: false,
			depth: Infinity,
			maxArrayLength: Infinity,
			maxStringLength: Infinity,
			breakLength: Infinity,
			compact: true,
			getters: false, // avoid side-effects
		});
	} catch {
		// Should rarely happen but just in case
		return null;
	}
}
