import * as os from "node:os";

import { escapeCommandArg } from "../util";

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
	// Escape a command line to be executed by the Coder binary, so ssh doesn't substitute variables.
	const escapeSubcommand: (str: string) => string =
		os.platform() === "win32"
			? // On Windows variables are %VAR%, and we need to use double quotes.
				(str) => escapeCommandArg(str).replace(/%/g, "%%")
			: // On *nix we can use single quotes to escape $VARS.
				// Note single quotes cannot be escaped inside single quotes.
				(str) => `'${str.replace(/'/g, "'\\''")}'`;

	const command = getHeaderCommand(config);
	if (!command) {
		return [];
	}
	return ["--header-command", escapeSubcommand(command)];
}
