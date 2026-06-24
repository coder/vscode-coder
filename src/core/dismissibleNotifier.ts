import * as vscode from "vscode";

import type { Memento } from "vscode";

const DISMISS = "Don't Show Again";

/** globalState keys under which "Don't Show Again" dismissals are stored. */
export type DismissibleNotificationKey =
	"coder.proxyUseLocalServerWarningDismissed";

export class DismissibleNotifier {
	public constructor(private readonly globalState: Memento) {}

	/**
	 * Show a warning notification with a "Don't Show Again" button that persists
	 * dismissal under `key`. Returns the chosen action, or undefined if dismissed,
	 * closed, or already dismissed before. Pass `modal` to block until the user
	 * answers; non-modal toasts can auto-dismiss, so blocking callers must set it.
	 */
	public async showDismissible(
		key: DismissibleNotificationKey,
		message: string,
		{
			actions = [],
			modal = false,
		}: { actions?: string[]; modal?: boolean } = {},
	): Promise<string | undefined> {
		if (this.globalState.get<boolean>(key)) {
			return undefined;
		}

		const choice = await vscode.window.showWarningMessage(
			message,
			{ modal },
			...actions,
			DISMISS,
		);

		if (choice === DISMISS) {
			await this.globalState.update(key, true);
			return undefined;
		}
		return choice;
	}
}
