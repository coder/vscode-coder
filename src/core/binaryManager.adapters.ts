import * as vscode from "vscode";
import {
	ConfigurationProvider,
	ProgressReporter,
	UserInteraction,
} from "./binaryManager.interfaces";

/**
 * VS Code implementation of ConfigurationProvider
 */
export class VSCodeConfigurationProvider implements ConfigurationProvider {
	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		const config = vscode.workspace.getConfiguration();
		return defaultValue !== undefined
			? config.get(key, defaultValue)
			: config.get(key);
	}
}

/**
 * VS Code implementation of ProgressReporter
 */
export class VSCodeProgressReporter implements ProgressReporter {
	async withProgress<T>(
		title: string,
		operation: (
			progress: {
				report: (value: { message?: string; increment?: number }) => void;
			},
			cancellationToken: {
				onCancellationRequested: (listener: () => void) => void;
			},
		) => Promise<T>,
	): Promise<T> {
		return vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title,
				cancellable: true,
			},
			operation,
		);
	}
}

/**
 * VS Code implementation of UserInteraction
 */
export class VSCodeUserInteraction implements UserInteraction {
	async showErrorMessage(
		message: string,
		options?: { detail?: string; modal?: boolean; useCustom?: boolean },
		...items: string[]
	): Promise<string | undefined> {
		return vscode.window.showErrorMessage(message, options || {}, ...items);
	}

	async showWarningMessage(
		message: string,
		options?: { detail?: string; modal?: boolean; useCustom?: boolean },
		...items: string[]
	): Promise<string | undefined> {
		return vscode.window.showWarningMessage(message, options || {}, ...items);
	}

	async openExternal(url: string): Promise<void> {
		await vscode.env.openExternal(vscode.Uri.parse(url));
	}
}
