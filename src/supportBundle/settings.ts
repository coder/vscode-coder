import * as vscode from "vscode";

import { type Logger } from "../logging/logger";
import { REMOTE_SSH_EXTENSION_IDS } from "../remote/sshExtension";

interface ConfigurationContribution {
	properties?: unknown;
}

interface ExtensionPackageJson {
	contributes?: unknown;
	name?: unknown;
	publisher?: unknown;
}

type SettingValue = unknown;
type SettingInspection = Record<string, SettingValue>;
type SettingDiagnostics = Record<string, SettingInspection>;

const REDACTED_SETTINGS = new Set([
	"coder.binarySource",
	"coder.globalFlags",
	"coder.headerCommand",
	"coder.sshConfig",
	"coder.sshFlags",
	"coder.tlsCertRefreshCommand",
]);

const REMOTE_SETTINGS = new Set([
	"remote.SSH.connectTimeout",
	"remote.SSH.logLevel",
	"remote.SSH.reconnectionGraceTime",
	"remote.SSH.serverShutdownTimeout",
	"remote.SSH.useExecServer",
	"remote.SSH.useLocalServer",
	"remote.autoForwardPorts",
]);

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageJson(value: unknown): ExtensionPackageJson | undefined {
	return isObject(value) ? value : undefined;
}

function configurationContributions(
	packageJson: ExtensionPackageJson,
): ConfigurationContribution[] {
	if (!isObject(packageJson.contributes)) {
		return [];
	}

	const configuration = packageJson.contributes["configuration"];
	const contributions = Array.isArray(configuration)
		? configuration
		: [configuration];
	return contributions.filter(isObject);
}

function isCoderExtension(extension: vscode.Extension<unknown>): boolean {
	const packageJson = readPackageJson(extension.packageJSON);
	return (
		extension.id === "coder.coder-remote" ||
		(packageJson?.publisher === "coder" && packageJson.name === "coder-remote")
	);
}

function isRemoteSshExtension(extension: vscode.Extension<unknown>): boolean {
	return (REMOTE_SSH_EXTENSION_IDS as readonly string[]).includes(extension.id);
}

function shouldCollectKey(
	extension: vscode.Extension<unknown>,
	key: string,
): boolean {
	return (
		(isCoderExtension(extension) && key.startsWith("coder.")) ||
		(isRemoteSshExtension(extension) && REMOTE_SETTINGS.has(key))
	);
}

function configurationKeys(): string[] {
	const keys = new Set<string>();

	for (const extension of vscode.extensions.all) {
		const packageJson = readPackageJson(extension.packageJSON);
		if (!packageJson) {
			continue;
		}

		for (const contribution of configurationContributions(packageJson)) {
			if (!isObject(contribution.properties)) {
				continue;
			}

			for (const key of Object.keys(contribution.properties)) {
				if (shouldCollectKey(extension, key)) {
					keys.add(key);
				}
			}
		}
	}

	return [...keys].sort();
}

function redactedSettingValue(value: SettingValue): string {
	const emptyArray = Array.isArray(value) && value.length === 0;
	return value === undefined || value === null || value === "" || emptyArray
		? "<empty>"
		: "<set>";
}

function maybeRedactSetting(key: string, value: SettingValue): SettingValue {
	return REDACTED_SETTINGS.has(key) ? redactedSettingValue(value) : value;
}

function collectSettingsDiagnostics(): SettingDiagnostics {
	const config = vscode.workspace.getConfiguration();
	const diagnostics: SettingDiagnostics = {};

	for (const key of configurationKeys()) {
		const inspected = config.inspect<SettingValue>(key);
		if (!inspected) {
			continue;
		}

		const entry: SettingInspection = {
			effective: maybeRedactSetting(key, config.get(key)),
		};
		for (const [name, value] of Object.entries(inspected)) {
			entry[name] = name === "key" ? value : maybeRedactSetting(key, value);
		}
		diagnostics[key] = entry;
	}

	return diagnostics;
}

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
