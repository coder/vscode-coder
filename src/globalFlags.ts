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
		...["--global-config", escapeCommandArg(configDir)],
		...getHeaderArgs(configs),
	];
}
