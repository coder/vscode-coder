import { escapeShellArg } from "../util";

import type { WorkspaceConfiguration } from "vscode";

/** Returns the header command from settings or the CODER_HEADER_COMMAND env var. */
export function getHeaderCommand(
	config: Pick<WorkspaceConfiguration, "get">,
): string | undefined {
	const cmd =
		config.get<string>("coder.headerCommand")?.trim() ||
		process.env.CODER_HEADER_COMMAND?.trim();

	return cmd || undefined;
}

/** Returns `--header-command` CLI args, escaped for the current platform. */
export function getHeaderArgs(
	config: Pick<WorkspaceConfiguration, "get">,
): string[] {
	const command = getHeaderCommand(config);
	if (!command) {
		return [];
	}
	return ["--header-command", escapeShellArg(command)];
}
