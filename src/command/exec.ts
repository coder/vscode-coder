import * as cp from "node:child_process";
import * as util from "node:util";

import { type Logger } from "../logging/logger";

interface ExecException {
	code?: number;
	stderr?: string;
	stdout?: string;
}

function isExecException(err: unknown): err is ExecException {
	return (err as ExecException).code !== undefined;
}

export interface ExecCommandOptions {
	env?: NodeJS.ProcessEnv;
	/** Title for logging (e.g., "Header command", "Certificate refresh"). */
	title?: string;
}

export type ExecCommandResult =
	| { success: true; stdout: string; stderr: string }
	| { success: false; stdout?: string; stderr?: string; exitCode?: number };

/**
 * Execute a shell command and return result with success/failure.
 * Handles errors gracefully and logs appropriately.
 */
export async function execCommand(
	command: string,
	logger: Logger,
	options?: ExecCommandOptions,
): Promise<ExecCommandResult> {
	const title = options?.title ?? "Command";
	// The command string and its output can carry credentials, so log neither.
	logger.debug(`Executing ${title}`);

	try {
		const result = await util.promisify(cp.exec)(command, {
			env: options?.env,
		});
		logger.debug(`${title} completed successfully`);
		return {
			success: true,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch (error) {
		if (isExecException(error)) {
			logger.warn(`${title} failed with exit code ${error.code}`);
			return {
				success: false,
				stdout: error.stdout,
				stderr: error.stderr,
				exitCode: error.code,
			};
		}

		logger.warn(`${title} failed to execute`);
		return { success: false };
	}
}
