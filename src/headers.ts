import * as cp from "child_process";
import * as os from "os";
import * as util from "util";

import { type Logger } from "./logging/logger";
import { escapeCommandArg } from "./util";

import type { WorkspaceConfiguration } from "vscode";

interface ExecException {
	code?: number;
	stderr?: string;
	stdout?: string;
}

function isExecException(err: unknown): err is ExecException {
	return typeof (err as ExecException).code !== "undefined";
}

export function getHeaderCommand(
	config: WorkspaceConfiguration,
): string | undefined {
	const cmd =
		config.get<string>("coder.headerCommand")?.trim() ||
		process.env.CODER_HEADER_COMMAND?.trim();

	return cmd || undefined;
}

export function getHeaderArgs(config: WorkspaceConfiguration): string[] {
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

/**
 * getHeaders executes the header command and parses the headers from stdout.
 * Both stdout and stderr are logged on error but stderr is otherwise ignored.
 * Throws an error if the process exits with non-zero or the JSON is invalid.
 * Returns undefined if there is no header command set. No effort is made to
 * validate the JSON other than making sure it can be parsed.
 */
export async function getHeaders(
	url: string | undefined,
	command: string | undefined,
	logger: Logger,
): Promise<Record<string, string>> {
	const headers: Record<string, string> = {};
	if (
		typeof url === "string" &&
		url.trim().length > 0 &&
		typeof command === "string" &&
		command.trim().length > 0
	) {
		let result: { stdout: string; stderr: string };
		try {
			result = await util.promisify(cp.exec)(command, {
				env: {
					...process.env,
					CODER_URL: url,
				},
			});
		} catch (error) {
			if (isExecException(error)) {
				logger.warn("Header command exited unexpectedly with code", error.code);
				logger.warn("stdout:", error.stdout);
				logger.warn("stderr:", error.stderr);
				throw new Error(
					`Header command exited unexpectedly with code ${error.code}`,
				);
			}
			throw new Error(`Header command exited unexpectedly: ${error}`);
		}
		if (!result.stdout) {
			// Allow no output for parity with the Coder CLI.
			return headers;
		}
		const lines = result.stdout.replace(/\r?\n$/, "").split(/\r?\n/);
		for (const line of lines) {
			const [key, value] = line.split(/=(.*)/);
			// Header names cannot be blank or contain whitespace and the Coder CLI
			// requires that there be an equals sign (the value can be blank though).
			if (
				key.length === 0 ||
				key.indexOf(" ") !== -1 ||
				typeof value === "undefined"
			) {
				throw new Error(
					`Malformed line from header command: [${line}] (out: ${result.stdout})`,
				);
			}
			headers[key] = value;
		}
	}
	return headers;
}
