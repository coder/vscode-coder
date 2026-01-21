import * as vscode from "vscode";

import { execCommand } from "../command/exec";
import { type Logger } from "../logging/logger";

/**
 * Returns the configured certificate refresh command, or undefined if not set.
 */
export function getRefreshCommand(): string | undefined {
	return (
		vscode.workspace
			.getConfiguration()
			.get<string>("coder.tlsCertRefreshCommand")
			?.trim() || undefined
	);
}

/**
 * Executes the certificate refresh command.
 * Returns true if successful, false otherwise.
 */
export async function refreshCertificates(
	command: string,
	logger: Logger,
): Promise<boolean> {
	const result = await execCommand(command, logger, {
		title: "Certificate refresh",
	});
	return result.success;
}
