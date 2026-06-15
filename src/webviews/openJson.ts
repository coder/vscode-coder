import * as vscode from "vscode";

import type { Logger } from "../logging/logger";

/** Open `content` as a JSON document beside the active editor, surfacing failures. */
export async function openJsonBeside(
	content: string,
	label: string,
	logger: Logger,
): Promise<void> {
	try {
		const doc = await vscode.workspace.openTextDocument({
			content,
			language: "json",
		});
		await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
	} catch (err) {
		logger.error(`Failed to open ${label} JSON`, err);
		vscode.window.showErrorMessage(
			`Failed to open ${label} JSON. Check \`Output > Coder\` for details.`,
		);
	}
}
