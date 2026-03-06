import { isKeyringSupported } from "./core/cliCredentialManager";
import { getHeaderArgs } from "./headers";
import { escapeCommandArg } from "./util";

import type { WorkspaceConfiguration } from "vscode";

import type { FeatureSet } from "./featureSet";

export type CliAuth =
	| { mode: "global-config"; configDir: string }
	| { mode: "url"; url: string };

/**
 * Returns the raw global flags from user configuration.
 */
export function getGlobalFlagsRaw(
	configs: Pick<WorkspaceConfiguration, "get">,
): string[] {
	return configs.get<string[]>("coder.globalFlags", []);
}

/**
 * Returns global configuration flags for Coder CLI commands.
 * Includes either `--global-config` or `--url` depending on the auth mode.
 */
export function getGlobalFlags(
	configs: Pick<WorkspaceConfiguration, "get">,
	auth: CliAuth,
): string[] {
	const authFlags =
		auth.mode === "url"
			? ["--url", escapeCommandArg(auth.url)]
			: ["--global-config", escapeCommandArg(auth.configDir)];

	const raw = getGlobalFlagsRaw(configs);
	const filtered = stripManagedFlags(raw);

	return [...filtered, ...authFlags, ...getHeaderArgs(configs)];
}

function stripManagedFlags(rawFlags: string[]): string[] {
	const filtered: string[] = [];
	for (let i = 0; i < rawFlags.length; i++) {
		if (isFlag(rawFlags[i], "--use-keyring")) {
			continue;
		}
		if (isFlag(rawFlags[i], "--global-config")) {
			// Skip the next item too when the value is a separate entry.
			if (rawFlags[i] === "--global-config") {
				i++;
			}
			continue;
		}
		filtered.push(rawFlags[i]);
	}
	return filtered;
}

function isFlag(item: string, name: string): boolean {
	return (
		item === name || item.startsWith(`${name}=`) || item.startsWith(`${name} `)
	);
}

/**
 * Returns true when the user has keyring enabled and the platform supports it.
 */
export function isKeyringEnabled(
	configs: Pick<WorkspaceConfiguration, "get">,
): boolean {
	return isKeyringSupported() && configs.get<boolean>("coder.useKeyring", true);
}

/**
 * Resolves how the CLI should authenticate: via the keyring (`--url`) or via
 * the global config directory (`--global-config`).
 */
export function resolveCliAuth(
	configs: Pick<WorkspaceConfiguration, "get">,
	featureSet: FeatureSet,
	deploymentUrl: string,
	configDir: string,
): CliAuth {
	if (isKeyringEnabled(configs) && featureSet.keyringAuth) {
		return { mode: "url", url: deploymentUrl };
	}
	return { mode: "global-config", configDir };
}

/**
 * Returns SSH flags for the `coder ssh` command from user configuration.
 */
export function getSshFlags(
	configs: Pick<WorkspaceConfiguration, "get">,
): string[] {
	// Make sure to match this default with the one in the package.json
	return configs.get<string[]>("coder.sshFlags", ["--disable-autostart"]);
}
