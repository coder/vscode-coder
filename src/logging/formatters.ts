import prettyBytes from "pretty-bytes";

import { safeStringify } from "./utils";

import type { AxiosRequestConfig } from "axios";

const SENSITIVE_HEADERS = new Set([
	"authorization",
	"coder-session-token",
	"cookie",
	"proxy-authorization",
	"set-cookie",
	"x-api-key",
]);

const SENSITIVE_BODY_FIELDS = new Set([
	"access_token",
	"client_secret",
	"code",
	"code_verifier",
	"id_token",
	"password",
	"refresh_token",
	"token",
]);

const REDACTED = "<redacted>";

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

export function formatHeaders(
	headers: Record<string, unknown>,
	extraSensitiveNames: readonly string[] = [],
): string {
	const extra = new Set(extraSensitiveNames.map((name) => name.toLowerCase()));
	const formattedHeaders = Object.entries(headers)
		.map(([key, value]) => {
			const name = key.toLowerCase();
			if (SENSITIVE_HEADERS.has(name) || extra.has(name)) {
				return `${key}: ${REDACTED}`;
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
		return safeStringify(redactBodyFields(body)) ?? "<invalid body>";
	} else {
		return "<no body>";
	}
}

function isSensitiveField(name: string): boolean {
	return SENSITIVE_BODY_FIELDS.has(name.toLowerCase());
}

/** Returns a copy of the body with known credential fields redacted (objects, params, JSON/form strings). */
function redactBodyFields(
	value: unknown,
	seen = new WeakSet<object>(),
): unknown {
	if (typeof value === "string") {
		return redactStringBody(value, seen);
	}
	if (value instanceof URLSearchParams) {
		const redacted = new URLSearchParams();
		for (const [key, entry] of value) {
			redacted.append(key, isSensitiveField(key) ? REDACTED : entry);
		}
		return redacted;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) {
			return value;
		}
		seen.add(value);
		return value.map((entry) => redactBodyFields(entry, seen));
	}
	if (isPlainObject(value)) {
		if (seen.has(value)) {
			return value;
		}
		seen.add(value);
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				isSensitiveField(key) ? REDACTED : redactBodyFields(entry, seen),
			]),
		);
	}
	return value;
}

function redactStringBody(body: string, seen: WeakSet<object>): unknown {
	const trimmed = body.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			return redactBodyFields(JSON.parse(trimmed), seen);
		} catch {
			// Not JSON; fall through.
		}
	}
	if (trimmed.includes("=")) {
		const params = new URLSearchParams(trimmed);
		for (const key of params.keys()) {
			if (isSensitiveField(key)) {
				return redactBodyFields(params, seen);
			}
		}
	}
	return body;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const proto: unknown = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
