import { execCommand } from "./command/exec";
import { type Logger } from "./logging/logger";

/**
 * Executes the header command and parses headers from stdout.
 * Throws on non-zero exit or malformed output. Returns empty headers if no
 * command is set.
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
		const result = await execCommand(command, logger, {
			title: "Header command",
			env: {
				...process.env,
				CODER_URL: url,
			},
		});

		if (!result.success) {
			throw new Error(
				result.exitCode === undefined
					? "Header command exited unexpectedly"
					: `Header command exited unexpectedly with code ${result.exitCode}`,
			);
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
			if (key.length === 0 || key.includes(" ") || value === undefined) {
				throw new Error(
					`Malformed line from header command: [${line}] (out: ${result.stdout})`,
				);
			}
			headers[key] = value;
		}
	}
	return headers;
}
