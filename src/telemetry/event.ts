import * as os from "node:os";
import * as vscode from "vscode";

import { toError } from "../error/errorUtils";

export type {
	SessionContext,
	TelemetryContext,
	TelemetryEvent,
} from "./wireFormat";

import type { SessionContext, TelemetryEvent } from "./wireFormat";

/** Telemetry level, mirrors `coder.telemetry.level`. Ordered: off < local. */
export type TelemetryLevel = "off" | "local";

/** Value types accepted from callers; the framework stringifies at the wire boundary. */
export type CallerPropertyValue = string | number | boolean;

/** Caller properties. `result` is framework-managed on traced events. */
export type CallerProperties = Record<string, CallerPropertyValue> & {
	result?: never;
};

/** Caller measurements. `durationMs` is framework-managed on traced events. */
export type CallerMeasurements = Record<string, number> & {
	durationMs?: never;
};

/**
 * Sink for telemetry events. `write` is sync and must buffer in memory; I/O
 * happens in `flush`/`dispose`. The service filters by `minLevel`; sinks can
 * still self-gate on other signals (e.g. deployment URL).
 */
export interface TelemetrySink {
	readonly name: string;
	readonly minLevel: TelemetryLevel;
	write(event: TelemetryEvent): void;
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

/** Build session attributes from the extension version and ambient host data. */
export function buildSession(
	extensionVersion: string,
	sessionId: string,
): SessionContext {
	return {
		extensionVersion,
		machineId: vscode.env.machineId,
		sessionId,
		osType: detectOsType(),
		osVersion: os.release(),
		hostArch: process.arch,
		platformName: vscode.env.appName,
		platformVersion: vscode.version,
	};
}

/** Read `version` from a package.json-like object, falling back to `"unknown"`. */
export function extractExtensionVersion(packageJSON: unknown): string {
	const version = (packageJSON as { version?: unknown } | null | undefined)
		?.version;
	return typeof version === "string" ? version : "unknown";
}

/** Normalize a thrown value into the event's `error` block. */
export function buildErrorBlock(
	value: unknown,
): NonNullable<TelemetryEvent["error"]> {
	const err = toError(value);
	const rawCode = (value as { code?: unknown } | null | undefined)?.code;
	const hasCode = typeof rawCode === "string" || typeof rawCode === "number";
	return {
		message: err.message,
		...(err.name && err.name !== "Error" && { type: err.name }),
		...(hasCode && { code: String(rawCode) }),
	};
}

// Node uses "win32" on Windows; OTel's os.type is "windows".
function detectOsType(): string {
	return process.platform === "win32" ? "windows" : process.platform;
}
