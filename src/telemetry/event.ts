import * as os from "node:os";
import * as vscode from "vscode";

import { toError } from "../error/errorUtils";

/** Telemetry level, mirrors `coder.telemetry.level`. Ordered: off < local. */
export type TelemetryLevel = "off" | "local";

/** Session-stable resource attributes. Field names follow OTel conventions. */
export interface SessionContext {
	readonly extensionVersion: string;
	readonly machineId: string;
	readonly sessionId: string;
	readonly osType: string;
	readonly osVersion: string;
	readonly hostArch: string;
	readonly platformType: string;
	readonly platformVersion: string;
}

/** Per-event context: session attributes plus the current deployment URL. */
export interface TelemetryContext extends SessionContext {
	deploymentUrl: string;
}

export interface TelemetryEvent {
	eventId: string;
	eventName: string;
	timestamp: string;
	eventSequence: number;

	context: TelemetryContext;

	properties: Record<string, string>;
	measurements: Record<string, number>;

	traceId?: string;

	error?: {
		message: string;
		type?: string;
		code?: string;
	};
}

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

/** Build session attributes. `extensionVersion` falls back to `"unknown"`. */
export function buildSession(ctx: vscode.ExtensionContext): SessionContext {
	// "unknown" only for malformed package.json or test fixtures missing `version`.
	const packageJson = ctx.extension.packageJSON as { version?: unknown };
	const extensionVersion =
		typeof packageJson.version === "string" ? packageJson.version : "unknown";

	return {
		extensionVersion,
		machineId: vscode.env.machineId,
		sessionId: vscode.env.sessionId,
		osType: detectOsType(),
		osVersion: os.release(),
		hostArch: process.arch,
		platformType: vscode.env.appName,
		platformVersion: vscode.version,
	};
}

/** Normalize a thrown value into the event's `error` block. */
export function buildErrorBlock(
	value: unknown,
): NonNullable<TelemetryEvent["error"]> {
	const err = toError(value);
	const block: NonNullable<TelemetryEvent["error"]> = { message: err.message };
	if (err.name && err.name !== "Error") {
		block.type = err.name;
	}
	const rawCode = (value as { code?: unknown } | null | undefined)?.code;
	if (typeof rawCode === "string" || typeof rawCode === "number") {
		block.code = String(rawCode);
	}
	return block;
}

// Node uses "win32" on Windows; OTel's os.type is "windows".
function detectOsType(): string {
	return process.platform === "win32" ? "windows" : process.platform;
}
