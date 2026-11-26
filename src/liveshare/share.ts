import * as vscode from "vscode";

const EXTENSION_ID = "ms-vsliveshare.vsliveshare";

interface LiveShareExtension {
	getApi(
		version: string,
		extensionId: string,
	): Promise<{
		share(): Promise<vscode.Uri | null>;
	} | null>;
}

/** Share only the single remote folder that the launch request selected. */
export async function shareFolder(folder: vscode.Uri): Promise<void> {
	const matches = () => {
		const folders = vscode.workspace.workspaceFolders;
		return (
			vscode.workspace.isTrusted &&
			folders?.length === 1 &&
			folders[0].uri.toString() === folder.toString()
		);
	};
	if (!matches()) {
		throw new Error(
			"Live Share requires the selected folder in a trusted workspace.",
		);
	}
	// Remote resolution activates Coder before SSH connects. Do not share until
	// the remote filesystem is available, or block extension activation on it.
	await vscode.workspace.fs.stat(folder);
	const choice = await vscode.window.showWarningMessage(
		"Share this workspace with Live Share?",
		{
			modal: true,
			detail: `${folder.path}\nLive Share will be installed if needed. People you invite can access the shared workspace.`,
		},
		"Start Sharing",
	);
	if (choice !== "Start Sharing") {
		return;
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Starting Live Share",
		},
		async () => {
			let extension =
				vscode.extensions.getExtension<LiveShareExtension>(EXTENSION_ID);
			if (!extension) {
				await vscode.commands.executeCommand(
					"workbench.extensions.installExtension",
					EXTENSION_ID,
				);
				extension =
					vscode.extensions.getExtension<LiveShareExtension>(EXTENSION_ID);
			}
			if (!extension) {
				throw new Error(
					"Live Share is not available. Enable it in this window and try Open Liveshare again.",
				);
			}
			const exports = await extension.activate();
			const api = await exports.getApi("1.0.4753", "coder.coder-remote");
			if (!api) {
				throw new Error(
					"The installed Live Share extension does not provide the required API.",
				);
			}
			if (!matches()) {
				throw new Error(
					"The workspace changed before Live Share could start. Open Liveshare again from the selected workspace.",
				);
			}
			const link = await api.share();
			if (!link) {
				await vscode.window.showInformationMessage(
					"Live Share was not started. Complete sign-in and try Open Liveshare again.",
				);
				return;
			}
			await vscode.env.clipboard.writeText(link.toString());
			await vscode.window.showInformationMessage(
				"Live Share invitation link copied to the clipboard.",
			);
		},
	);
}
