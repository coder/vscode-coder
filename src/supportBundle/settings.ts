import * as vscode from "vscode";

import { type Logger } from "../logging/logger";

// Paths, hostnames, URLs, and command strings: anything user-supplied that
// could identify a machine or deployment in a shared bundle.
const REDACTED_SETTINGS: ReadonlySet<string> = new Set([
	"coder.binaryDestination",
	"coder.binarySource",
	"coder.defaultUrl",
	"coder.globalFlags",
	"coder.headerCommand",
	"coder.proxyBypass",
	"coder.proxyLogDirectory",
	"coder.sshConfig",
	"coder.sshFlags",
	"coder.tlsAltHost",
	"coder.tlsCaFile",
	"coder.tlsCertFile",
	"coder.tlsCertRefreshCommand",
	"coder.tlsKeyFile",
]);

// Explicit allowlist instead of package.json discovery: discovery requires
// the extension to be installed (it isn't for tests/headless runs) and
// silently misses settings declared via contributes.configurationDefaults.
const COLLECTED_SETTINGS: readonly string[] = [
	...REDACTED_SETTINGS,
	"coder.autologin",
	"coder.disableNotifications",
	"coder.disableSignatureVerification",
	"coder.disableUpdateNotifications",
	"coder.enableDownloads",
	"coder.experimental.oauth",
	"coder.httpClientLogLevel",
	"coder.insecure",
	"coder.networkThreshold.latencyMs",
	"coder.telemetry.level",
	"coder.telemetry.local",
	"coder.useKeyring",
	"remote.SSH.connectTimeout",
	"remote.SSH.logLevel",
	"remote.SSH.reconnectionGraceTime",
	"remote.SSH.serverShutdownTimeout",
	"remote.SSH.useExecServer",
	"remote.SSH.useLocalServer",
	"remote.autoForwardPorts",
].sort();

type SettingValue = unknown;
type SettingInspection = Record<string, SettingValue>;

function redactedSettingValue(value: SettingValue): string {
	const emptyArray = Array.isArray(value) && value.length === 0;
	return value === undefined || value === null || value === "" || emptyArray
		? "<empty>"
		: "<set>";
}

function maybeRedact(
	key: string,
	name: string,
	value: SettingValue,
): SettingValue {
	// `key` and `languageIds` are inspect() metadata, not the secret payload.
	if (name === "key" || name === "languageIds") {
		return value;
	}
	return REDACTED_SETTINGS.has(key) ? redactedSettingValue(value) : value;
}

function collectSettingsDiagnostics(): Record<string, SettingInspection> {
	const config = vscode.workspace.getConfiguration();
	const diagnostics: Record<string, SettingInspection> = {};
	for (const key of COLLECTED_SETTINGS) {
		const inspected = config.inspect<SettingValue>(key);
		if (!inspected) {
			continue;
		}
		const entry: SettingInspection = {
			effective: maybeRedact(key, "effective", config.get(key)),
		};
		for (const [name, value] of Object.entries(inspected)) {
			entry[name] = maybeRedact(key, name, value);
		}
		diagnostics[key] = entry;
	}
	return diagnostics;
}

/**
 * Returns a UTF-8 JSON snapshot of `inspect()` output for the allowlisted
 * `coder.*` / `remote.*` settings. Sensitive values (paths, hostnames,
 * URLs, commands) are replaced with `<set>` or `<empty>`.
 */
export function collectSettingsFile(logger: Logger): Uint8Array | undefined {
	try {
		const diagnostics = collectSettingsDiagnostics();
		if (Object.keys(diagnostics).length === 0) {
			return undefined;
		}
		return Buffer.from(`${JSON.stringify(diagnostics, null, "\t")}\n`);
	} catch (error) {
		logger.warn("Could not collect VS Code settings", error);
		return undefined;
	}
}
