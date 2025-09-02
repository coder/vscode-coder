import { WorkspaceConfiguration } from "vscode";
import { getHeaderArgs } from "./headers";
import { escapeCommandArg } from "./util";

export function getGlobalFlags(
	configs: WorkspaceConfiguration,
	configDir?: string,
): string[] {
	const globalFlags = configs.get<string[]>("coder.globalFlags") || [];
	const headerArgs = getHeaderArgs(configs);
	const globalConfigArgs = configDir
		? ["--global-config", escapeCommandArg(configDir)]
		: [];

	// Precedence of "coder.headerCommand" is higher than "coder.globalConfig" with the "--header-command" flag
	let filteredGlobalFlags = globalFlags;
	if (headerArgs.length > 0) {
		filteredGlobalFlags = globalFlags.filter(
			(flag) => !flag.startsWith("--header-command"),
		);
	}

	if (globalConfigArgs.length > 0) {
		filteredGlobalFlags = globalFlags.filter(
			(flag) => !flag.startsWith("--global-config"),
		);
	}
	return [...filteredGlobalFlags, ...headerArgs, ...globalConfigArgs];
}
