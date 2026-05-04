import type { WorkspaceConfiguration } from "vscode";

import type { TelemetryLevel } from "../telemetry/event";

export const TELEMETRY_LEVEL_SETTING = "coder.telemetry.level";
export const LOCAL_JSONL_SETTING = "coder.telemetry.localJsonl";

/** Telemetry level. Falls back to `local` for any invalid value. */
export function readTelemetryLevel(
	cfg: Pick<WorkspaceConfiguration, "get">,
): TelemetryLevel {
	const value = cfg.get<string>(TELEMETRY_LEVEL_SETTING);
	return value === "off" || value === "local" ? value : "local";
}

export interface LocalJsonlConfig {
	flushIntervalMs: number;
	flushBatchSize: number;
	bufferLimit: number;
	maxFileBytes: number;
	maxAgeDays: number;
	maxTotalBytes: number;
}

export const LOCAL_JSONL_DEFAULTS: LocalJsonlConfig = {
	flushIntervalMs: 15_000,
	flushBatchSize: 100,
	bufferLimit: 500,
	maxFileBytes: 5 * 1024 * 1024,
	maxAgeDays: 30,
	maxTotalBytes: 100 * 1024 * 1024,
};

/** Reads the local JSONL sink config, defaulting any missing or invalid
 *  field. Each field must be a positive number to override the default. */
export function readLocalJsonlConfig(
	cfg: Pick<WorkspaceConfiguration, "get">,
): LocalJsonlConfig {
	const raw = cfg.get(LOCAL_JSONL_SETTING);
	const obj =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	return {
		flushIntervalMs: positiveNumber(
			obj.flushIntervalMs,
			LOCAL_JSONL_DEFAULTS.flushIntervalMs,
		),
		flushBatchSize: positiveNumber(
			obj.flushBatchSize,
			LOCAL_JSONL_DEFAULTS.flushBatchSize,
		),
		bufferLimit: positiveNumber(
			obj.bufferLimit,
			LOCAL_JSONL_DEFAULTS.bufferLimit,
		),
		maxFileBytes: positiveNumber(
			obj.maxFileBytes,
			LOCAL_JSONL_DEFAULTS.maxFileBytes,
		),
		maxAgeDays: positiveNumber(obj.maxAgeDays, LOCAL_JSONL_DEFAULTS.maxAgeDays),
		maxTotalBytes: positiveNumber(
			obj.maxTotalBytes,
			LOCAL_JSONL_DEFAULTS.maxTotalBytes,
		),
	};
}

function positiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && value > 0 ? value : fallback;
}
