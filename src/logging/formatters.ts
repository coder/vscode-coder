import prettyBytes from "pretty-bytes";

import { safeStringify } from "./utils";

import type { AxiosRequestConfig } from "axios";

const SENSITIVE_HEADERS = new Set([
	"Coder-Session-Token",
	"Proxy-Authorization",
]);

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
	return method?.toUpperCase() || "GET";
}

export function formatSize(size: number | undefined): string {
	return size === undefined ? "(? B)" : `(${prettyBytes(size)})`;
}

export function formatUri(config: AxiosRequestConfig | undefined): string {
	return config?.url || "<no url>";
}

export function formatHeaders(headers: Record<string, unknown>): string {
	const formattedHeaders = Object.entries(headers)
		.map(([key, value]) => {
			if (SENSITIVE_HEADERS.has(key)) {
				return `${key}: <redacted>`;
			}
			const strValue = typeof value === "string" ? value : safeStringify(value);
			return `${key}: ${strValue}`;
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
