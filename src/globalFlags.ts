import { WorkspaceConfiguration } from "vscode";
import { getHeaderArgs } from "./headers";
import { escapeCommandArg } from "./util";

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
