import * as vscode from "vscode";

import { errToStr } from "../api/api-helper";
import { isKeyringEnabled } from "../settings/cli";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";

/** Logs a failed credential store and shows an error that opens `coder.useKeyring`. */
export function showStoreCredentialsError(
	error: unknown,
	configs: Pick<WorkspaceConfiguration, "get">,
	logger: Logger,
): void {
	logger.error("Failed to store credentials:", error);
	let message = `Failed to store credentials: ${errToStr(error)}.`;
	if (isKeyringEnabled(configs)) {
		message +=
			' To store the token in a file instead, set "coder.useKeyring" to false.';
	}
	void vscode.window
		.showErrorMessage(message, "Open Settings")
		.then((action) => {
			if (action === "Open Settings") {
				void vscode.commands.executeCommand(
					"workbench.action.openSettings",
					"coder.useKeyring",
				);
			}
		});
}
