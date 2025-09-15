/**
 * Provides access to configuration settings
 */
export interface ConfigurationProvider {
	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
}

/**
 * Provides progress reporting capabilities for long-running operations
 */
export interface ProgressReporter {
	/**
	 * Reports progress for a download operation with cancellation support
	 * @param title The title to display for the progress
	 * @param operation The operation to run with progress reporting
	 * @returns Promise that resolves to true if completed, false if cancelled
	 */
	withProgress<T>(
		title: string,
		operation: (
			progress: {
				report: (value: { message?: string; increment?: number }) => void;
			},
			cancellationToken: {
				onCancellationRequested: (listener: () => void) => void;
			},
		) => Promise<T>,
	): Promise<T>;
}

/**
 * User interaction capabilities for showing dialogs and opening external URLs
 */
export interface UserInteraction {
	/**
	 * Shows an error message with optional action buttons
	 * @param message The message to display
	 * @param options Additional options for the dialog
	 * @param items Action button labels
	 * @returns Promise that resolves to the selected action or undefined
	 */
	showErrorMessage(
		message: string,
		options?: { detail?: string; modal?: boolean; useCustom?: boolean },
		...items: string[]
	): Promise<string | undefined>;

	/**
	 * Shows a warning message with optional action buttons
	 * @param message The message to display
	 * @param options Additional options for the dialog
	 * @param items Action button labels
	 * @returns Promise that resolves to the selected action or undefined
	 */
	showWarningMessage(
		message: string,
		options?: { detail?: string; modal?: boolean; useCustom?: boolean },
		...items: string[]
	): Promise<string | undefined>;

	/**
	 * Opens an external URL
	 * @param url The URL to open
	 * @returns Promise that resolves when the URL is opened
	 */
	openExternal(url: string): Promise<void>;
}
