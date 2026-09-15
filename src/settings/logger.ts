import { HttpClientLogLevel } from "../logging/types";

import type { WorkspaceConfiguration } from "vscode";

export const CONNECTION_LOG_BUFFER_SIZE_SETTING =
	"coder.connectionLogBuffer.size";
export const DEFAULT_CONNECTION_LOG_BUFFER_SIZE = 1000;
/**
 * Largest configurable capacity. Bounds the entry count kept in memory; each
 * entry still holds live `args` references, so this is a count, not a byte cap.
 */
export const MAX_CONNECTION_LOG_BUFFER_SIZE = 10_000;

const HTTP_CLIENT_LOG_LEVEL_SETTING = "coder.httpClientLogLevel";

/**
 * Number of connection log entries to buffer below the output channel's level.
 * `0` disables buffering; larger values are clamped to
 * {@link MAX_CONNECTION_LOG_BUFFER_SIZE}. Missing, non-numeric, non-finite, or
 * negative values fall back to the default rather than silently disabling.
 */
export function readConnectionLogBufferSize(
	cfg: Pick<WorkspaceConfiguration, "get">,
): number {
	const value = cfg.get(
		CONNECTION_LOG_BUFFER_SIZE_SETTING,
		DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
	);
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return DEFAULT_CONNECTION_LOG_BUFFER_SIZE;
	}
	return Math.min(Math.floor(value), MAX_CONNECTION_LOG_BUFFER_SIZE);
}

/** HTTP client logging verbosity. Falls back to `BASIC` for unknown values. */
export function readHttpClientLogLevel(
	cfg: Pick<WorkspaceConfiguration, "get">,
): HttpClientLogLevel {
	const value = cfg
		.get(
			HTTP_CLIENT_LOG_LEVEL_SETTING,
			HttpClientLogLevel[HttpClientLogLevel.BASIC],
		)
		.toUpperCase();
	return (
		HttpClientLogLevel[value as keyof typeof HttpClientLogLevel] ??
		HttpClientLogLevel.BASIC
	);
}
