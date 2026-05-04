import * as os from "node:os";
import * as vscode from "vscode";

import { toError } from "../error/errorUtils";

/** Telemetry level, mirrors `coder.telemetry.level`. Ordered: off < local. */
export type TelemetryLevel = "off" | "local";

/** Caller properties. `result` is framework-managed on traced events. */
export type CallerProperties = Record<string, string> & { result?: never };

/** Caller measurements. `durationMs` is framework-managed on traced events. */
export type CallerMeasurements = Record<string, number> & {
	durationMs?: never;
};

/** Session-stable resource attributes. Field names are inspired by OTel
 * resource attributes; they are camelCase TypeScript and not a 1:1 mapping. */
export interface SessionContext {
	readonly extensionVersion: string;
	readonly machineId: string;
	readonly sessionId: string;
	readonly osType: string;
	readonly osVersion: string;
	readonly hostArch: string;
	readonly platformName: string;
	readonly platformVersion: string;
}

/** Per-event context: session attributes plus the current deployment URL. */
export interface TelemetryContext extends SessionContext {
	readonly deploymentUrl: string;
}

export interface TelemetryEvent {
	readonly eventId: string;
	readonly eventName: string;
	readonly timestamp: string;
	readonly eventSequence: number;

	readonly context: TelemetryContext;

	readonly properties: Readonly<Record<string, string>>;
	readonly measurements: Readonly<Record<string, number>>;

	/** Shared by all events in a trace. Maps to OTel `trace_id`. */
	readonly traceId?: string;
	/** Set on phase children only. Equals the parent event's `eventId`. Maps to OTel `parent_span_id`. */
	readonly parentEventId?: string;

	readonly error?: Readonly<{
		message: string;
		type?: string;
		code?: string;
	}>;
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
		platformName: vscode.env.appName,
		platformVersion: vscode.version,
	};
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
