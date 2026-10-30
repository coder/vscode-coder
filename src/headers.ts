import { execCommand } from "./command/exec";
import { type Logger } from "./logging/logger";

/** RFC 9110 header name. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

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
		const lines = result.stdout
			.replace(/^\ufeff/, "")
			.replace(/\r?\n$/, "")
			.split(/\r?\n/);
		for (const [index, line] of lines.entries()) {
			const [key, value] = line.split(/=(.*)/);
			// Log redaction matches these names, but axios trims some characters
			// before sending. Fail instead of trimming here, so the command author
			// sees the malformed output.
			if (!HEADER_NAME.test(key) || value === undefined) {
				// The output can carry credentials; reference the line by number only.
				throw new Error(
					`Malformed line ${index + 1} from header command output`,
				);
			}
			headers[key] = value;
		}
	}
	return headers;
}
