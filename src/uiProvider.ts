import * as vscode from "vscode";

/**
 * Interface for abstracting VS Code UI interactions to enable testing.
 * This allows us to inject mock UI behaviors in tests while using
 * real VS Code UI in production.
 */
export interface UIProvider {
	/**
	 * Create a quick pick for selecting from a list of items.
	 */
	createQuickPick<T extends vscode.QuickPickItem>(): vscode.QuickPick<T>;

	/**
	 * Show an information message with optional actions.
	 */
	showInformationMessage(
		message: string,
		...items: string[]
	): Thenable<string | undefined>;
	showInformationMessage(
		message: string,
		options: vscode.MessageOptions,
		...items: string[]
	): Thenable<string | undefined>;
	showInformationMessage<T extends vscode.MessageItem>(
		message: string,
		...items: T[]
	): Thenable<T | undefined>;
	showInformationMessage<T extends vscode.MessageItem>(
		message: string,
		options: vscode.MessageOptions,
		...items: T[]
	): Thenable<T | undefined>;

	/**
	 * Show an error message with optional actions.
	 */
	showErrorMessage(
		message: string,
		...items: string[]
	): Thenable<string | undefined>;
	showErrorMessage(
		message: string,
		options: vscode.MessageOptions,
		...items: string[]
	): Thenable<string | undefined>;
	showErrorMessage<T extends vscode.MessageItem>(
		message: string,
		...items: T[]
	): Thenable<T | undefined>;
	showErrorMessage<T extends vscode.MessageItem>(
		message: string,
		options: vscode.MessageOptions,
		...items: T[]
	): Thenable<T | undefined>;

	/**
	 * Show a warning message with optional actions.
	 */
	showWarningMessage(
		message: string,
		...items: string[]
	): Thenable<string | undefined>;
	showWarningMessage(
		message: string,
		options: vscode.MessageOptions,
		...items: string[]
	): Thenable<string | undefined>;
	showWarningMessage<T extends vscode.MessageItem>(
		message: string,
		...items: T[]
	): Thenable<T | undefined>;
	showWarningMessage<T extends vscode.MessageItem>(
		message: string,
		options: vscode.MessageOptions,
		...items: T[]
	): Thenable<T | undefined>;

	/**
	 * Show progress with a cancellable task.
	 */
	withProgress<R>(
		options: vscode.ProgressOptions,
		task: (
			progress: vscode.Progress<{
				message?: string | undefined;
				increment?: number | undefined;
			}>,
			token: vscode.CancellationToken,
		) => Thenable<R>,
	): Thenable<R>;

	/**
	 * Create an input box for text entry.
	 */
	createInputBox(): vscode.InputBox;
}

/**
 * Default implementation using VS Code's window API.
 */
export class DefaultUIProvider implements UIProvider {
	constructor(private readonly vscodeWindow: typeof vscode.window) {}

	createQuickPick<T extends vscode.QuickPickItem>(): vscode.QuickPick<T> {
		return this.vscodeWindow.createQuickPick<T>();
	}

	showInformationMessage(
		message: string,
		...args: unknown[]
	): Thenable<string | undefined> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (this.vscodeWindow.showInformationMessage as any)(message, ...args);
	}

	showErrorMessage(
		message: string,
		...args: unknown[]
	): Thenable<string | undefined> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (this.vscodeWindow.showErrorMessage as any)(message, ...args);
	}

	showWarningMessage(
		message: string,
		...args: unknown[]
	): Thenable<string | undefined> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (this.vscodeWindow.showWarningMessage as any)(message, ...args);
	}

	withProgress<R>(
		options: vscode.ProgressOptions,
		task: (
			progress: vscode.Progress<{
				message?: string | undefined;
				increment?: number | undefined;
			}>,
			token: vscode.CancellationToken,
		) => Thenable<R>,
	): Thenable<R> {
		return this.vscodeWindow.withProgress(options, task);
	}

	createInputBox(): vscode.InputBox {
		return this.vscodeWindow.createInputBox();
	}
}
