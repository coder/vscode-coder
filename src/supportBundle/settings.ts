import * as vscode from "vscode";

import { type Logger } from "../logging/logger";

// Masked to <set>/<empty> because their value can hold a secret; every other
// collected setting is kept verbatim, so only add a key here if it can.
const REDACTED_SETTINGS: ReadonlySet<string> = new Set([
	"coder.globalFlags",
	"coder.headerCommand",
	"coder.tlsCertRefreshCommand",
]);

// Explicit allowlist: package.json discovery needs the extension installed
// (not so in tests) and misses contributes.configurationDefaults.
const COLLECTED_SETTINGS: readonly string[] = [
	...REDACTED_SETTINGS,
	"coder.autologin",
	"coder.binaryDestination",
	"coder.binarySource",
	"coder.defaultUrl",
	"coder.disableNotifications",
	"coder.disableSignatureVerification",
	"coder.disableUpdateNotifications",
	"coder.enableDownloads",
	"coder.experimental.oauth",
	"coder.globalConfig",
	"coder.httpClientLogLevel",
	"coder.insecure",
	"coder.networkThreshold.latencyMs",
	"coder.proxyBypass",
	"coder.proxyLogDirectory",
	"coder.sshConfig",
	"coder.sshFlags",
	"coder.telemetry.level",
	"coder.telemetry.local",
	"coder.tlsAltHost",
	"coder.tlsCaFile",
	"coder.tlsCertFile",
	"coder.tlsKeyFile",
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

/** inspect() metadata + public package.json default; not user-supplied. */
const REDACTION_PASSTHROUGH: ReadonlySet<string> = new Set([
	"key",
	"languageIds",
	"defaultValue",
]);

/**
 * UTF-8 JSON snapshot of `inspect()` for the allowlisted `coder.*` / `remote.*`
 * settings, with sensitive values replaced by `<set>` or `<empty>`.
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

function maybeRedact(
	key: string,
	name: string,
	value: SettingValue,
): SettingValue {
	if (REDACTION_PASSTHROUGH.has(name)) {
		return value;
	}
	return REDACTED_SETTINGS.has(key) ? redactedSettingValue(value) : value;
}

function redactedSettingValue(value: SettingValue): string {
	const emptyArray = Array.isArray(value) && value.length === 0;
	return value === undefined || value === null || value === "" || emptyArray
		? "<empty>"
		: "<set>";
}
