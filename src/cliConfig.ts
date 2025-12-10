import { type WorkspaceConfiguration } from "vscode";

import { getHeaderArgs } from "./headers";
import { escapeCommandArg } from "./util";

/**
 * Returns global configuration flags for Coder CLI commands.
 * Always includes the `--global-config` argument with the specified config directory.
 */
export function getGlobalFlags(
	configs: WorkspaceConfiguration,
	configDir: string,
): string[] {
	// Last takes precedence/overrides previous ones
	return [
		...(configs.get<string[]>("coder.globalFlags") || []),
		"--global-config",
		escapeCommandArg(configDir),
		...getHeaderArgs(configs),
	];
}

/**
 * Returns SSH flags for the `coder ssh` command from user configuration.
 */
export function getSshFlags(configs: WorkspaceConfiguration): string[] {
	// Make sure to match this default with the one in the package.json
	return configs.get<string[]>("coder.sshFlags", ["--disable-autostart"]);
}
