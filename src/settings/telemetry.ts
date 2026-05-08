import type { WorkspaceConfiguration } from "vscode";

import type { TelemetryLevel } from "../telemetry/event";

export const TELEMETRY_LEVEL_SETTING = "coder.telemetry.level";
export const LOCAL_TELEMETRY_SETTING = "coder.telemetry.local";
export const LOCAL_SINK_SETTING = LOCAL_TELEMETRY_SETTING;

/** Telemetry level. Falls back to `local` for unknown or invalid values. */
export function readTelemetryLevel(
	cfg: Pick<WorkspaceConfiguration, "get">,
): TelemetryLevel {
	const value = cfg.get<string>(TELEMETRY_LEVEL_SETTING);
	return value === "off" || value === "local" ? value : "local";
}

export interface LocalSinkConfig {
	readonly flushIntervalMs: number;
	readonly flushBatchSize: number;
	readonly bufferLimit: number;
	readonly maxFileBytes: number;
	readonly maxAgeDays: number;
	readonly maxTotalBytes: number;
}

export interface HttpRequestsTelemetryConfig {
	readonly windowSeconds: number;
}

export const LOCAL_SINK_DEFAULTS: LocalSinkConfig = {
	flushIntervalMs: 15_000,
	flushBatchSize: 100,
	bufferLimit: 500,
	maxFileBytes: 5 * 1024 * 1024,
	maxAgeDays: 30,
	maxTotalBytes: 100 * 1024 * 1024,
};

export const HTTP_REQUESTS_TELEMETRY_DEFAULTS: HttpRequestsTelemetryConfig = {
	windowSeconds: 60,
};

// Defense in depth: VS Code does not enforce JSON schema at runtime, so users
// can drop in any value via settings.json. Mirrors the minimums in package.json.
const LOCAL_SINK_MINIMUMS: LocalSinkConfig = {
	flushIntervalMs: 1000,
	flushBatchSize: 1,
	bufferLimit: 10,
	maxFileBytes: 4096,
	maxAgeDays: 1,
	maxTotalBytes: 4096,
};

const HTTP_REQUESTS_TELEMETRY_MINIMUMS: HttpRequestsTelemetryConfig = {
	windowSeconds: 1,
};

/** Per-field: missing, non-numeric, or below-minimum values fall back to defaults. */
export function readLocalSinkConfig(
	cfg: Pick<WorkspaceConfiguration, "get">,
): LocalSinkConfig {
	const obj = readLocalTelemetryObject(cfg);
	const read = (key: keyof LocalSinkConfig): number => {
		const value = obj[key];
		return typeof value === "number" && value >= LOCAL_SINK_MINIMUMS[key]
			? value
			: LOCAL_SINK_DEFAULTS[key];
	};
	return {
		flushIntervalMs: read("flushIntervalMs"),
		flushBatchSize: read("flushBatchSize"),
		bufferLimit: read("bufferLimit"),
		maxFileBytes: read("maxFileBytes"),
		maxAgeDays: read("maxAgeDays"),
		maxTotalBytes: read("maxTotalBytes"),
	};
}

export function readHttpRequestsTelemetryConfig(
	cfg: Pick<WorkspaceConfiguration, "get">,
): HttpRequestsTelemetryConfig {
	const obj = readLocalTelemetryObject(cfg);
	const httpRequests =
		obj.httpRequests &&
		typeof obj.httpRequests === "object" &&
		!Array.isArray(obj.httpRequests)
			? (obj.httpRequests as Record<string, unknown>)
			: {};
	const read = (key: keyof HttpRequestsTelemetryConfig): number => {
		const value = httpRequests[key];
		return typeof value === "number" &&
			value >= HTTP_REQUESTS_TELEMETRY_MINIMUMS[key]
			? value
			: HTTP_REQUESTS_TELEMETRY_DEFAULTS[key];
	};
	return {
		windowSeconds: read("windowSeconds"),
	};
}

function readLocalTelemetryObject(
	cfg: Pick<WorkspaceConfiguration, "get">,
): Record<string, unknown> {
	const raw = cfg.get(LOCAL_TELEMETRY_SETTING);
	return raw && typeof raw === "object" && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};
}
