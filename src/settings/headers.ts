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

/** Returns `--header-command` args; shell callers pass `escapeShellArg` as `esc`. */
export function getHeaderArgs(
	config: Pick<WorkspaceConfiguration, "get">,
	esc: (s: string) => string = (s) => s,
): string[] {
	const command = getHeaderCommand(config);
	if (!command) {
		return [];
	}
	return ["--header-command", esc(command)];
}
