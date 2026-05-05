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
	readonly flushIntervalMs: number;
	readonly flushBatchSize: number;
	readonly bufferLimit: number;
	readonly maxFileBytes: number;
	readonly maxAgeDays: number;
	readonly maxTotalBytes: number;
}

export const LOCAL_JSONL_DEFAULTS: LocalJsonlConfig = {
	flushIntervalMs: 15_000,
	flushBatchSize: 100,
	bufferLimit: 500,
	maxFileBytes: 5 * 1024 * 1024,
	maxAgeDays: 30,
	maxTotalBytes: 100 * 1024 * 1024,
};

// Mirrors the schema minimums in package.json.
const MINIMUMS: LocalJsonlConfig = {
	flushIntervalMs: 1000,
	flushBatchSize: 1,
	bufferLimit: 10,
	maxFileBytes: 4096,
	maxAgeDays: 1,
	maxTotalBytes: 4096,
};

/** Missing or below-minimum fields fall back to the default. */
export function readLocalJsonlConfig(
	cfg: Pick<WorkspaceConfiguration, "get">,
): LocalJsonlConfig {
	const raw = cfg.get(LOCAL_JSONL_SETTING);
	const obj =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const read = (key: keyof LocalJsonlConfig): number =>
		numberAtLeast(obj[key], MINIMUMS[key], LOCAL_JSONL_DEFAULTS[key]);
	return {
		flushIntervalMs: read("flushIntervalMs"),
		flushBatchSize: read("flushBatchSize"),
		bufferLimit: read("bufferLimit"),
		maxFileBytes: read("maxFileBytes"),
		maxAgeDays: read("maxAgeDays"),
		maxTotalBytes: read("maxTotalBytes"),
	};
}

function numberAtLeast(
	value: unknown,
	minimum: number,
	fallback: number,
): number {
	return typeof value === "number" && value >= minimum ? value : fallback;
}
