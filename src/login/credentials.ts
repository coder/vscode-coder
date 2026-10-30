import * as vscode from "vscode";

import { errToStr } from "../error/normalize";
import { type CliAuth, isKeyringEnabled } from "../settings/cli";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";

/** Tells the user when the keyring is on but the CLI could not use it for this URL. */
export function notifyKeyringSkipped(
	auth: CliAuth | undefined,
	configs: Pick<WorkspaceConfiguration, "get">,
): void {
	if (
		auth?.store === "extension" &&
		auth.useKeyring === false &&
		isKeyringEnabled(configs)
	) {
		void vscode.window.showInformationMessage(
			"Session not saved to the OS keyring: http:// deployments need Coder CLI 2.39 or later. The Coder CLI in your terminal won't share it.",
		);
	}
}

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
