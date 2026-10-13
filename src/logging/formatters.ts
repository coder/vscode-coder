import { type AxiosError, type AxiosRequestConfig, isAxiosError } from "axios";
import { Buffer } from "node:buffer";
import util from "node:util";
import prettyBytes from "pretty-bytes";

import { lowercase } from "../common/strings";

const SENSITIVE_HEADERS: ReadonlySet<Lowercase<string>> = new Set([
	"authorization",
	"coder-session-token",
	"cookie",
	"proxy-authorization",
	"set-cookie",
	"x-api-key",
]);

/** Credential fields, such as those in OAuth requests, responses, and sessions. */
const SENSITIVE_FIELDS: ReadonlySet<Lowercase<string>> = new Set([
	"access_token",
	"client_secret",
	"code",
	"code_verifier",
	"id_token",
	"password",
	"refresh_token",
	"registration_access_token",
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
		return stringify(redactBody(body)) ?? "<invalid body>";
	} else {
		return "<no body>";
	}
}

/**
 * Copy of `value` with credentials redacted and Axios errors summarized at any
 * depth; unchanged values keep their reference. Never throws.
 */
export function redactSecrets(value: unknown): unknown {
	try {
		return redact(value, new WeakSet());
	} catch {
		return REDACTED;
	}
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
	if (typeof value !== "object" || value === null || seen.has(value)) {
		return value;
	}
	seen.add(value);
	if (isAxiosError(value)) {
		return summarizeAxiosError(value);
	}
	if (value instanceof URLSearchParams) {
		return redactParams(value);
	}
	if (Array.isArray(value)) {
		return redactArray(value, seen);
	}
	// Copying a Date, Buffer, or class instance property by property would mangle it.
	const proto: unknown = Object.getPrototypeOf(value);
	return value instanceof Error || proto === Object.prototype || proto === null
		? redactProperties(value, seen)
		: value;
}

function redactArray(
	array: readonly unknown[],
	seen: WeakSet<object>,
): readonly unknown[] {
	let copy: unknown[] | undefined;
	for (const [index, entry] of array.entries()) {
		const redacted = redact(entry, seen);
		if (redacted !== entry) {
			copy ??= [...array];
			copy[index] = redacted;
		}
	}
	return copy ?? array;
}

/** Reads data properties only, so getters never run. */
function redactProperties(value: object, seen: WeakSet<object>): object {
	let descriptors: PropertyDescriptorMap | undefined;
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !("value" in descriptor)) {
			continue;
		}
		const entry: unknown = descriptor.value;
		const redacted = isCredential(key, entry) ? REDACTED : redact(entry, seen);
		if (redacted !== entry) {
			descriptors ??= Object.getOwnPropertyDescriptors(value);
			descriptors[key] = { ...descriptor, value: redacted };
		}
	}
	if (!descriptors) {
		return value;
	}
	if (value instanceof Error) {
		// V8's `stack` accessor reads the original error's internal slot.
		descriptors.stack = {
			value: value.stack,
			writable: true,
			configurable: true,
		};
	}
	return Object.create(
		Object.getPrototypeOf(value) as object | null,
		descriptors,
	) as object;
}

function redactParams(params: URLSearchParams): URLSearchParams {
	const entries = [...params];
	if (!entries.some(([key, entry]) => isCredential(key, entry))) {
		return params;
	}
	return new URLSearchParams(
		entries.map(([key, entry]) => [
			key,
			isCredential(key, entry) ? REDACTED : entry,
		]),
	);
}

/** Credentials are strings, so numeric fields such as a close `code` stay readable. */
function isCredential(key: PropertyKey, value: unknown): boolean {
	return (
		typeof key === "string" &&
		typeof value === "string" &&
		SENSITIVE_FIELDS.has(lowercase(key))
	);
}

/** Axios error paths expose only the serialized body, so JSON and form-encoded strings are parsed too. */
function redactBody(body: unknown): unknown {
	if (typeof body !== "string") {
		return redactSecrets(body);
	}
	const trimmed = body.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			const redacted = redactSecrets(parsed);
			return redacted === parsed ? body : redacted;
		} catch {
			// Not JSON; fall through.
		}
	}
	if (trimmed.includes("=")) {
		const params = new URLSearchParams(trimmed);
		const redacted = redactParams(params);
		return redacted === params ? body : redacted;
	}
	return body;
}

/**
 * Returns the byte size of the data if it can be determined from the data's intrinsic properties,
 * otherwise returns undefined (e.g., for plain objects and arrays that would require serialization).
 */
export function sizeOf(data: unknown): number | undefined {
	if (data === null || data === undefined) {
		return 0;
	}
	if (typeof data === "boolean") {
		return 4;
	}
	if (typeof data === "number") {
		return 8;
	}
	if (typeof data === "string" || typeof data === "bigint") {
		return Buffer.byteLength(data.toString());
	}
	if (
		Buffer.isBuffer(data) ||
		data instanceof ArrayBuffer ||
		ArrayBuffer.isView(data)
	) {
		return data.byteLength;
	}
	if (
		typeof data === "object" &&
		"size" in data &&
		typeof data.size === "number"
	) {
		return data.size;
	}
	return undefined;
}

/** Drops the error's config and socket, which hold the request's credentials. */
function summarizeAxiosError(error: AxiosError) {
	return {
		name: error.name,
		message: error.message,
		code: error.code,
		method: formatMethod(error.config?.method),
		url: formatUri(error.config),
		status: error.response?.status,
		data: redactBody(error.response?.data),
	};
}

export function safeStringify(data: unknown): string | null {
	return stringify(redactSecrets(data));
}

function stringify(data: unknown): string | null {
	try {
		return util.inspect(data, {
			showHidden: false,
			// Bounded so a single log line cannot balloon in size.
			depth: 8,
			maxArrayLength: 100,
			maxStringLength: 10_000,
			breakLength: Infinity,
			compact: true,
			getters: false, // avoid side-effects
		});
	} catch {
		return null;
	}
}
