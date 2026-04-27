import * as os from "node:os";
import * as vscode from "vscode";

import { toError } from "../error/errorUtils";

/**
 * Session-stable resource attributes carried by every event. Field names
 * follow OpenTelemetry semantic conventions (`os.type`, `os.version`,
 * `host.arch`) so a future OTel collector translation is a rename.
 */
export interface TelemetryContext {
	extensionVersion: string;
	machineId: string;
	sessionId: string;
	deploymentUrl: string;
	osType: string;
	osVersion: string;
	hostArch: string;
	platformType: string;
	platformVersion: string;
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
 * Destination for telemetry events. `write` runs on the hot path and must
 * buffer in memory; I/O happens in `flush`/`dispose`. Sinks own their own
 * gating beyond the service-level kill switch (e.g. a server sink emits only
 * when the user opts into deployment telemetry).
 */
export interface TelemetrySink {
	readonly name: string;
	write(event: TelemetryEvent): void;
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

/**
 * Build the session-stable context attached to every event. `deploymentUrl`
 * starts empty and is updated once the deployment is known.
 */
export function buildContext(ctx: vscode.ExtensionContext): TelemetryContext {
	const packageJson = ctx.extension.packageJSON as
		| { version?: unknown }
		| undefined;
	const rawVersion = packageJson?.version;
	const extensionVersion = typeof rawVersion === "string" ? rawVersion : "";

	return {
		extensionVersion,
		machineId: vscode.env.machineId,
		sessionId: vscode.env.sessionId,
		deploymentUrl: "",
		osType: detectOsType(),
		osVersion: os.release(),
		hostArch: process.arch,
		platformType: detectPlatformType(vscode.env.appName ?? ""),
		platformVersion: vscode.version ?? "",
	};
}

/**
 * Normalize any thrown value into the structured `error` block of an event.
 * `type` comes from `Error.name` (skipped when generic). `code` captures
 * Node's `error.code` for system errors and HTTP statuses for API errors.
 */
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

function detectPlatformType(appName: string): string {
	const lower = appName.toLowerCase();
	if (lower.includes("cursor")) {
		return "cursor";
	}
	if (lower.includes("vscodium")) {
		return "vscodium";
	}
	return "vscode";
}

function detectOsType(): string {
	switch (process.platform) {
		case "linux":
			return "linux";
		case "darwin":
			return "darwin";
		case "win32":
			return "windows";
		default:
			return process.platform;
	}
}
