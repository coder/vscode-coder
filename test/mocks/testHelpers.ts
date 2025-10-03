import { vi } from "vitest";
import * as vscode from "vscode";

import { type Logger } from "@/logging/logger";

/**
 * Mock configuration provider that integrates with the vscode workspace configuration mock.
 * Use this to set configuration values that will be returned by vscode.workspace.getConfiguration().
 */
export class MockConfigurationProvider {
	private config = new Map<string, unknown>();

	constructor() {
		this.setupVSCodeMock();
	}

	/**
	 * Set a configuration value that will be returned by vscode.workspace.getConfiguration().get()
	 */
	set(key: string, value: unknown): void {
		this.config.set(key, value);
	}

	/**
	 * Get a configuration value (for testing purposes)
	 */
	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.config.get(key);
		return value !== undefined ? (value as T) : defaultValue;
	}

	/**
	 * Clear all configuration values
	 */
	clear(): void {
		this.config.clear();
	}

	/**
	 * Setup the vscode.workspace.getConfiguration mock to return our values
	 */
	private setupVSCodeMock(): void {
		vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
			(section?: string) => {
				// Create a snapshot of the current config when getConfiguration is called
				const snapshot = new Map(this.config);
				const getFullKey = (part: string) =>
					section ? `${section}.${part}` : part;

				return {
					get: vi.fn((key: string, defaultValue?: unknown) => {
						const value = snapshot.get(getFullKey(key));
						return value !== undefined ? value : defaultValue;
					}),
					has: vi.fn((key: string) => {
						return snapshot.has(getFullKey(key));
					}),
					inspect: vi.fn(),
					update: vi.fn((key: string, value: unknown) => {
						this.config.set(getFullKey(key), value);
						return Promise.resolve();
					}),
				};
			},
		);
	}
}

/**
 * Mock progress reporter that integrates with vscode.window.withProgress.
 * Use this to control progress reporting behavior and cancellation in tests.
 */
export class MockProgressReporter {
	private shouldCancel = false;
	private progressReports: Array<{ message?: string; increment?: number }> = [];

	constructor() {
		this.setupVSCodeMock();
	}

	/**
	 * Set whether the progress should be cancelled
	 */
	setCancellation(cancel: boolean): void {
		this.shouldCancel = cancel;
	}

	/**
	 * Get all progress reports that were made
	 */
	getProgressReports(): Array<{ message?: string; increment?: number }> {
		return [...this.progressReports];
	}

	/**
	 * Clear all progress reports
	 */
	clearProgressReports(): void {
		this.progressReports = [];
	}

	/**
	 * Setup the vscode.window.withProgress mock
	 */
	private setupVSCodeMock(): void {
		vi.mocked(vscode.window.withProgress).mockImplementation(
			async <T>(
				_options: vscode.ProgressOptions,
				task: (
					progress: vscode.Progress<{ message?: string; increment?: number }>,
					token: vscode.CancellationToken,
				) => Thenable<T>,
			): Promise<T> => {
				const progress = {
					report: vi.fn((value: { message?: string; increment?: number }) => {
						this.progressReports.push(value);
					}),
				};

				const cancellationToken: vscode.CancellationToken = {
					isCancellationRequested: this.shouldCancel,
					onCancellationRequested: vi.fn((listener: (x: unknown) => void) => {
						if (this.shouldCancel) {
							setTimeout(listener, 0);
						}
						return { dispose: vi.fn() };
					}),
				};

				return task(progress, cancellationToken);
			},
		);
	}
}

/**
 * Mock user interaction that integrates with vscode.window message dialogs.
 * Use this to control user responses in tests.
 */
export class MockUserInteraction {
	private responses = new Map<string, string | undefined>();
	private externalUrls: string[] = [];

	constructor() {
		this.setupVSCodeMock();
	}

	/**
	 * Set a response for a specific message
	 */
	setResponse(message: string, response: string | undefined): void {
		this.responses.set(message, response);
	}

	/**
	 * Get all URLs that were opened externally
	 */
	getExternalUrls(): string[] {
		return [...this.externalUrls];
	}

	/**
	 * Clear all external URLs
	 */
	clearExternalUrls(): void {
		this.externalUrls = [];
	}

	/**
	 * Clear all responses
	 */
	clearResponses(): void {
		this.responses.clear();
	}

	/**
	 * Setup the vscode.window message dialog mocks
	 */
	private setupVSCodeMock(): void {
		const getResponse = (message: string): string | undefined => {
			return this.responses.get(message);
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const handleMessage = (message: string): Thenable<any> => {
			const response = getResponse(message);
			return Promise.resolve(response);
		};

		vi.mocked(vscode.window.showErrorMessage).mockImplementation(handleMessage);

		vi.mocked(vscode.window.showWarningMessage).mockImplementation(
			handleMessage,
		);

		vi.mocked(vscode.window.showInformationMessage).mockImplementation(
			handleMessage,
		);

		vi.mocked(vscode.env.openExternal).mockImplementation(
			(target: vscode.Uri): Promise<boolean> => {
				this.externalUrls.push(target.toString());
				return Promise.resolve(true);
			},
		);
	}
}

// Simple in-memory implementation of Memento
export class InMemoryMemento implements vscode.Memento {
	private storage = new Map<string, unknown>();

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		return this.storage.has(key) ? (this.storage.get(key) as T) : defaultValue;
	}

	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			this.storage.delete(key);
		} else {
			this.storage.set(key, value);
		}
		return Promise.resolve();
	}

	keys(): readonly string[] {
		return Array.from(this.storage.keys());
	}
}

// Simple in-memory implementation of SecretStorage
export class InMemorySecretStorage implements vscode.SecretStorage {
	private secrets = new Map<string, string>();
	private isCorrupted = false;
	private listeners: Array<(e: vscode.SecretStorageChangeEvent) => void> = [];

	onDidChange: vscode.Event<vscode.SecretStorageChangeEvent> = (listener) => {
		this.listeners.push(listener);
		return {
			dispose: () => {
				const index = this.listeners.indexOf(listener);
				if (index > -1) {
					this.listeners.splice(index, 1);
				}
			},
		};
	};

	async get(key: string): Promise<string | undefined> {
		if (this.isCorrupted) {
			return Promise.reject(new Error("Storage corrupted"));
		}
		return this.secrets.get(key);
	}

	async store(key: string, value: string): Promise<void> {
		if (this.isCorrupted) {
			return Promise.reject(new Error("Storage corrupted"));
		}
		const oldValue = this.secrets.get(key);
		this.secrets.set(key, value);
		if (oldValue !== value) {
			this.fireChangeEvent(key);
		}
	}

	async delete(key: string): Promise<void> {
		if (this.isCorrupted) {
			return Promise.reject(new Error("Storage corrupted"));
		}
		const hadKey = this.secrets.has(key);
		this.secrets.delete(key);
		if (hadKey) {
			this.fireChangeEvent(key);
		}
	}

	corruptStorage(): void {
		this.isCorrupted = true;
	}

	private fireChangeEvent(key: string): void {
		const event: vscode.SecretStorageChangeEvent = { key };
		this.listeners.forEach((listener) => listener(event));
	}
}

export function createMockLogger(): Logger {
	return {
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}
