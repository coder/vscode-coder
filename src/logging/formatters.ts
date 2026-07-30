import prettyBytes from "pretty-bytes";

import { lowercase } from "../util";

import { safeStringify } from "./utils";

import type { AxiosRequestConfig } from "axios";

const SENSITIVE_HEADERS: ReadonlySet<Lowercase<string>> = new Set([
	"authorization",
	"coder-session-token",
	"cookie",
	"proxy-authorization",
	"set-cookie",
	"x-api-key",
]);

/** Credential fields from OAuth token requests/responses, logged at BODY level. */
const SENSITIVE_BODY_FIELDS: ReadonlySet<Lowercase<string>> = new Set([
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
	const extra: ReadonlySet<Lowercase<string>> = new Set(
		extraSensitiveNames.map(lowercase),
	);
	const formattedHeaders = Object.entries(headers)
		.map(([key, value]) => {
			const name = lowercase(key);
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

/**
 * Redact known credential fields, copying only what changes; untouched
 * values keep their original reference. util.inspect has no replacer
 * hook, so the value is walked before stringifying.
 */
function redactBodyFields(
	value: unknown,
	seen = new WeakSet<object>(),
): unknown {
	if (typeof value === "string") {
		return redactStringBody(value, seen);
	}
	if (value instanceof URLSearchParams) {
		const keys = [...value.keys()];
		if (!keys.some((key) => SENSITIVE_BODY_FIELDS.has(lowercase(key)))) {
			return value;
		}
		return new URLSearchParams(
			[...value].map(([key, entry]) => [
				key,
				SENSITIVE_BODY_FIELDS.has(lowercase(key)) ? REDACTED : entry,
			]),
		);
	}
	if (typeof value !== "object" || value === null || seen.has(value)) {
		return value;
	}
	seen.add(value);
	if (Array.isArray(value)) {
		const entries: readonly unknown[] = value;
		let copy: unknown[] | undefined;
		entries.forEach((entry, index) => {
			const redacted = redactBodyFields(entry, seen);
			if (redacted !== entry) {
				copy ??= [...entries];
				copy[index] = redacted;
			}
		});
		return copy ?? value;
	}
	// Rebuilding a Date or Buffer from its entries would mangle its output.
	const proto: unknown = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) {
		return value;
	}
	let copy: Record<string, unknown> | undefined;
	for (const [key, entry] of Object.entries(value)) {
		const redacted = SENSITIVE_BODY_FIELDS.has(lowercase(key))
			? REDACTED
			: redactBodyFields(entry, seen);
		if (redacted !== entry) {
			copy ??= { ...value };
			copy[key] = redacted;
		}
	}
	return copy ?? value;
}

/**
 * Axios error paths expose only the serialized body, so JSON and
 * form-encoded strings are parsed too. Clean strings pass through as-is.
 */
function redactStringBody(body: string, seen: WeakSet<object>): unknown {
	const trimmed = body.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			const redacted = redactBodyFields(parsed, seen);
			return redacted === parsed ? body : redacted;
		} catch {
			// Not JSON; fall through.
		}
	}
	if (trimmed.includes("=")) {
		const params = new URLSearchParams(trimmed);
		const redacted = redactBodyFields(params, seen);
		return redacted === params ? body : redacted;
	}
	return body;
}
