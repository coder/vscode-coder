import type { InternalAxiosRequestConfig } from "axios";
import prettyBytes from "pretty-bytes";

const SENSITIVE_HEADERS = ["Coder-Session-Token", "Proxy-Authorization"];

export function formatMethod(method: string | undefined): string {
	return (method ?? "GET").toUpperCase();
}

export function formatContentLength(headers: Record<string, unknown>): string {
	const len = headers["content-length"];
	if (len && typeof len === "string") {
		const bytes = parseInt(len, 10);
		return isNaN(bytes) ? "(?b)" : `(${prettyBytes(bytes)})`;
	}
	return "(?b)";
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
