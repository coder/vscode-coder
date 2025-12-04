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

type DisableAutostartSetting = "auto" | "always" | "never";

/**
 * Determines whether autostart should be disabled based on the setting and platform.
 * - "always": disable on all platforms
 * - "never": never disable
 * - "auto": disable only on macOS (due to sleep/wake issues)
 */
export function shouldDisableAutostart(
	configs: WorkspaceConfiguration,
	platform: NodeJS.Platform,
): boolean {
	const setting = configs.get<DisableAutostartSetting>(
		"coder.disableAutostart",
		"auto",
	);
	return setting === "always" || (setting === "auto" && platform === "darwin");
}
