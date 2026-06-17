import * as vscode from "vscode";

const DISMISS = "Don't Show Again";

/**
 * Show an info notification with a "Don't Show Again" button that persists
 * dismissal under `key`. Returns the chosen action, or undefined if dismissed
 * or closed.
 */
export async function showDismissibleNotification(
	message: string,
	memento: vscode.Memento,
	options: { key: string; actions?: string[] },
): Promise<string | undefined> {
	const { key, actions = [] } = options;

	if (memento.get<boolean>(key)) {
		return undefined;
	}

	const choice = await vscode.window.showInformationMessage(
		message,
		...actions,
		DISMISS,
	);

	if (choice === DISMISS) {
		await memento.update(key, true);
		return undefined;
	}
	return choice;
}
