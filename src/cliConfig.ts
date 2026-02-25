import * as vscode from "vscode";

import { type FeatureSet } from "./featureSet";
import { getHeaderArgs } from "./headers";
import { isKeyringSupported } from "./keyringStore";
import { escapeCommandArg } from "./util";

export type CliAuth =
	| { mode: "global-config"; configDir: string }
	| { mode: "url"; url: string };

/**
 * Returns the raw global flags from user configuration.
 */
export function getGlobalFlagsRaw(
	configs: Pick<vscode.WorkspaceConfiguration, "get">,
): string[] {
	return configs.get<string[]>("coder.globalFlags", []);
}

/**
 * Returns global configuration flags for Coder CLI commands.
 * Includes either `--global-config` or `--url` depending on the auth mode.
 */
export function getGlobalFlags(
	configs: Pick<vscode.WorkspaceConfiguration, "get">,
	auth: CliAuth,
): string[] {
	const authFlags =
		auth.mode === "url"
			? ["--url", escapeCommandArg(auth.url)]
			: ["--global-config", escapeCommandArg(auth.configDir)];

	// Last takes precedence/overrides previous ones
	return [
		...getGlobalFlagsRaw(configs),
		...authFlags,
		...getHeaderArgs(configs),
	];
}

/**
 * Single source of truth: should the extension use the OS keyring for this session?
 * Requires CLI >= 2.29.0, macOS or Windows, and the coder.useKeyring setting enabled.
 */
export function shouldUseKeyring(featureSet: FeatureSet): boolean {
	return (
		featureSet.keyringAuth &&
		isKeyringSupported() &&
		vscode.workspace.getConfiguration().get<boolean>("coder.useKeyring", true)
	);
}

/**
 * Resolves how the CLI should authenticate: via the keyring (`--url`) or via
 * the global config directory (`--global-config`).
 */
export function resolveCliAuth(
	featureSet: FeatureSet,
	deploymentUrl: string | undefined,
	configDir: string,
): CliAuth {
	if (shouldUseKeyring(featureSet) && deploymentUrl) {
		return { mode: "url", url: deploymentUrl };
	}
	return { mode: "global-config", configDir };
}

/**
 * Returns SSH flags for the `coder ssh` command from user configuration.
 */
export function getSshFlags(
	configs: Pick<vscode.WorkspaceConfiguration, "get">,
): string[] {
	// Make sure to match this default with the one in the package.json
	return configs.get<string[]>("coder.sshFlags", ["--disable-autostart"]);
}
