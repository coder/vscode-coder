import axios, {
	AxiosError,
	AxiosHeaders,
	type AxiosAdapter,
	type AxiosResponse,
	type InternalAxiosRequestConfig,
} from "axios";
import { vi } from "vitest";
import * as vscode from "vscode";

import type { User } from "coder/site/src/api/typesGenerated";
import type { IncomingMessage } from "node:http";

import type { CoderApi } from "@/api/coderApi";
import type { Logger } from "@/logging/logger";

/**
 * Mock configuration provider that integrates with the vscode workspace configuration mock.
 * Use this to set configuration values that will be returned by vscode.workspace.getConfiguration().
 */
export class MockConfigurationProvider {
	private readonly config = new Map<string, unknown>();

	constructor() {
		this.setupVSCodeMock();
	}

	/**
	 * Set a configuration value that will be returned by vscode.workspace.getConfiguration().get()
	 * Automatically fires onDidChangeConfiguration event (emulating VS Code behavior).
	 */
	set(key: string, value: unknown): void {
		this.config.set(key, value);
		this.fireConfigChangeEvent(key);
	}

	/**
	 * Get a configuration value (for testing purposes)
	 */
	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.config.get(key);
		return value === undefined ? defaultValue : (value as T);
	}

	/**
	 * Clear all configuration values
	 */
	clear(): void {
		this.config.clear();
	}

	/**
	 * Fire configuration change event for a specific setting.
	 */
	private fireConfigChangeEvent(setting: string): void {
		const fireEvent = (
			vscode.workspace as typeof vscode.workspace & {
				__fireDidChangeConfiguration: (
					e: vscode.ConfigurationChangeEvent,
				) => void;
			}
		).__fireDidChangeConfiguration;

		fireEvent({
			affectsConfiguration: (section: string) => section === setting,
		});
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
						return value === undefined ? defaultValue : value;
					}),
					has: vi.fn((key: string) => {
						return snapshot.has(getFullKey(key));
					}),
					inspect: vi.fn(),
					update: vi.fn((key: string, value: unknown) => {
						this.set(getFullKey(key), value);
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
 * Mock user interaction that integrates with vscode.window message dialogs and input boxes.
 * Use this to control user responses in tests.
 */
export class MockUserInteraction {
	private readonly responses = new Map<string, string | undefined>();
	private inputBoxValue: string | undefined;
	private inputBoxValidateInput: ((value: string) => Promise<void>) | undefined;
	private externalUrls: string[] = [];

	constructor() {
		this.setupVSCodeMock();
	}

	/**
	 * Set a response for a specific message dialog
	 */
	setResponse(message: string, response: string | undefined): void {
		this.responses.set(message, response);
	}

	/**
	 * Set the value to return from showInputBox.
	 * Pass undefined to simulate user cancelling.
	 */
	setInputBoxValue(value: string | undefined): void {
		this.inputBoxValue = value;
	}

	/**
	 * Set a custom validateInput handler for showInputBox.
	 * This allows tests to simulate the validation callback behavior.
	 */
	setInputBoxValidateInput(fn: (value: string) => Promise<void>): void {
		this.inputBoxValidateInput = fn;
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
	 * Clear all responses and input box values
	 */
	clear(): void {
		this.responses.clear();
		this.inputBoxValue = undefined;
		this.inputBoxValidateInput = undefined;
		this.externalUrls = [];
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

		vi.mocked(vscode.window.showInputBox).mockImplementation(
			async (options?: vscode.InputBoxOptions) => {
				const value = this.inputBoxValue;
				if (value === undefined) {
					return undefined; // User cancelled
				}

				if (options?.validateInput) {
					const validationResult = await options.validateInput(value);
					if (validationResult) {
						// Validation failed - in real VS Code this would show error
						// For tests, we can use the custom handler or return undefined
						if (this.inputBoxValidateInput) {
							await this.inputBoxValidateInput(value);
						}
						return undefined;
					}
				} else if (this.inputBoxValidateInput) {
					// Run custom validation handler even without options.validateInput
					await this.inputBoxValidateInput(value);
				}

				return value;
			},
		);
	}
}

// Simple in-memory implementation of Memento
export class InMemoryMemento implements vscode.Memento {
	private readonly storage = new Map<string, unknown>();

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
	private readonly secrets = new Map<string, string>();
	private isCorrupted = false;
	private readonly listeners: Array<
		(e: vscode.SecretStorageChangeEvent) => void
	> = [];

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

	keys(): Promise<string[]> {
		if (this.isCorrupted) {
			return Promise.reject(new Error("Storage corrupted"));
		}
		return Promise.resolve(Array.from(this.secrets.keys()));
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

export function createMockStream(
	content: string,
	options: {
		chunkSize?: number;
		delay?: number;
		// If defined will throw an error instead of closing normally
		error?: NodeJS.ErrnoException;
	} = {},
): IncomingMessage {
	const { chunkSize = 8, delay = 1, error } = options;

	const buffer = Buffer.from(content);
	let position = 0;
	let closeCallback: ((...args: unknown[]) => void) | null = null;
	let errorCallback: ((error: Error) => void) | null = null;

	return {
		on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
			if (event === "data") {
				const sendChunk = () => {
					if (position < buffer.length) {
						const chunk = buffer.subarray(
							position,
							Math.min(position + chunkSize, buffer.length),
						);
						position += chunkSize;
						callback(chunk);
						if (position < buffer.length) {
							setTimeout(sendChunk, delay);
						} else {
							setImmediate(() => {
								if (error && errorCallback) {
									errorCallback(error);
								} else if (closeCallback) {
									closeCallback();
								}
							});
						}
					}
				};
				setTimeout(sendChunk, delay);
			} else if (event === "error") {
				errorCallback = callback;
			} else if (event === "close") {
				closeCallback = callback;
			}
		}),
		destroy: vi.fn(),
	} as unknown as IncomingMessage;
}

/**
 * Mock status bar that integrates with vscode.window.createStatusBarItem.
 * Use this to inspect status bar state in tests.
 */
export class MockStatusBar {
	text = "";
	tooltip: string | vscode.MarkdownString = "";
	backgroundColor: vscode.ThemeColor | undefined;
	color: string | vscode.ThemeColor | undefined;
	command: string | vscode.Command | undefined;
	accessibilityInformation: vscode.AccessibilityInformation | undefined;
	name: string | undefined;
	priority: number | undefined;
	alignment: vscode.StatusBarAlignment = vscode.StatusBarAlignment.Left;

	readonly show = vi.fn();
	readonly hide = vi.fn();
	readonly dispose = vi.fn();

	constructor() {
		this.setupVSCodeMock();
	}

	/**
	 * Reset all status bar state
	 */
	reset(): void {
		this.text = "";
		this.tooltip = "";
		this.backgroundColor = undefined;
		this.color = undefined;
		this.command = undefined;
		this.show.mockClear();
		this.hide.mockClear();
		this.dispose.mockClear();
	}

	/**
	 * Setup the vscode.window.createStatusBarItem mock
	 */
	private setupVSCodeMock(): void {
		vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(
			this as unknown as vscode.StatusBarItem,
		);
	}
}

/**
 * Mock CoderApi for testing. Tracks method calls and allows controlling responses.
 */
export class MockCoderApi implements Pick<
	CoderApi,
	| "setHost"
	| "setSessionToken"
	| "setCredentials"
	| "getHost"
	| "getAuthenticatedUser"
	| "dispose"
> {
	private _host: string | undefined;
	private _token: string | undefined;
	private _disposed = false;
	private authenticatedUser: User | Error | undefined;

	readonly setHost = vi.fn((host: string | undefined) => {
		this._host = host;
	});

	readonly setSessionToken = vi.fn((token: string) => {
		this._token = token;
	});

	readonly setCredentials = vi.fn(
		(host: string | undefined, token: string | undefined) => {
			this._host = host;
			this._token = token;
		},
	);

	readonly getHost = vi.fn(() => this._host);

	readonly getAuthenticatedUser = vi.fn((): Promise<User> => {
		if (this.authenticatedUser instanceof Error) {
			return Promise.reject(this.authenticatedUser);
		}
		if (!this.authenticatedUser) {
			return Promise.reject(new Error("Not authenticated"));
		}
		return Promise.resolve(this.authenticatedUser);
	});

	readonly dispose = vi.fn(() => {
		this._disposed = true;
	});

	/**
	 * Get current host (for assertions)
	 */
	get host(): string | undefined {
		return this._host;
	}

	/**
	 * Get current token (for assertions)
	 */
	get token(): string | undefined {
		return this._token;
	}

	/**
	 * Check if dispose was called (for assertions)
	 */
	get disposed(): boolean {
		return this._disposed;
	}

	/**
	 * Set the authenticated user that will be returned by getAuthenticatedUser.
	 * Pass an Error to make getAuthenticatedUser reject.
	 */
	setAuthenticatedUserResponse(user: User | Error | undefined): void {
		this.authenticatedUser = user;
	}
}

/**
 * Mock OAuthSessionManager for testing.
 * Provides no-op implementations of all public methods.
 */
export class MockOAuthSessionManager {
	readonly setDeployment = vi.fn().mockResolvedValue(undefined);
	readonly clearDeployment = vi.fn();
	readonly login = vi.fn().mockResolvedValue({ access_token: "test-token" });
	readonly handleCallback = vi.fn().mockResolvedValue(undefined);
	readonly refreshToken = vi
		.fn()
		.mockResolvedValue({ access_token: "test-token" });
	readonly revokeRefreshToken = vi.fn().mockResolvedValue(undefined);
	readonly isLoggedInWithOAuth = vi.fn().mockResolvedValue(false);
	readonly clearOAuthState = vi.fn().mockResolvedValue(undefined);
	readonly dispose = vi.fn();
}

export class MockOAuthInterceptor {
	readonly setDeployment = vi.fn().mockResolvedValue(undefined);
	readonly clearDeployment = vi.fn();
	readonly dispose = vi.fn();
}

/**
 * Create a mock User for testing.
 */
export function createMockUser(overrides: Partial<User> = {}): User {
	return {
		id: "user-123",
		username: "testuser",
		email: "test@example.com",
		name: "Test User",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		last_seen_at: new Date().toISOString(),
		status: "active",
		organization_ids: [],
		roles: [],
		avatar_url: "",
		login_type: "password",
		theme_preference: "",
		...overrides,
	};
}

/**
 * Creates an AxiosError for testing.
 */
export function createAxiosError(
	status: number,
	message: string,
	config: Record<string, unknown> = {},
): AxiosError {
	const error = new AxiosError(
		message,
		"ERR_BAD_REQUEST",
		undefined,
		undefined,
		{
			status,
			statusText: message,
			headers: {},
			config: { headers: new AxiosHeaders() },
			data: {},
		},
	);
	error.config = { headers: new AxiosHeaders(), ...config };
	return error;
}

type MockAdapterFn = ReturnType<typeof vi.fn<AxiosAdapter>>;

const AXIOS_MOCK_SETUP_EXAMPLE = `
vi.mock("axios", async () => {
  const actual = await vi.importActual<typeof import("axios")>("axios");
  const mockAdapter = vi.fn();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn((config) =>
        actual.default.create({ ...config, adapter: mockAdapter }),
      ),
      __mockAdapter: mockAdapter,
    },
  };
});`;

/**
 * Gets the mock axios adapter from the mocked axios module.
 * The axios module must be mocked with __mockAdapter exposed.
 *
 * @throws Error if axios mock is not set up correctly, with instructions on how to fix it
 */
export function getAxiosMockAdapter(): MockAdapterFn {
	const axiosWithMock = axios as typeof axios & {
		__mockAdapter?: MockAdapterFn;
	};
	const mockAdapter = axiosWithMock.__mockAdapter;

	if (!mockAdapter) {
		throw new Error(
			"Axios mock adapter not found. Make sure to mock axios with __mockAdapter:\n" +
				AXIOS_MOCK_SETUP_EXAMPLE,
		);
	}

	return mockAdapter;
}

/**
 * Sets up mock routes for the axios adapter.
 *
 * Route values can be:
 * - Any data: Returns 200 OK with that data
 * - Error instance: Rejects with that error
 *
 * If no route matches, rejects with a 404 AxiosError.
 *
 * @example
 * ```ts
 * setupAxiosMockRoutes(mockAdapter, {
 *   "/.well-known/oauth": metadata,                       // Returns 200 with metadata
 *   "/oauth2/register": new Error("Registration failed"), // Throws error
 *   "/api/v2/users/me": user,                             // Returns 200 with user
 * });
 * ```
 */
export function setupAxiosMockRoutes(
	mockAdapter: MockAdapterFn,
	routes: Record<string, unknown>,
): void {
	mockAdapter.mockImplementation(
		async (
			config: InternalAxiosRequestConfig,
		): Promise<AxiosResponse<unknown>> => {
			for (const [pattern, value] of Object.entries(routes)) {
				if (config.url?.includes(pattern)) {
					if (value instanceof Error) {
						throw value;
					}
					const data =
						typeof value === "function" ? await value(config) : value;
					return {
						data,
						status: 200,
						statusText: "OK",
						headers: new AxiosHeaders(),
						config,
					};
				}
			}
			const error = new AxiosError(
				`Request failed with status code 404`,
				"ERR_BAD_REQUEST",
				undefined,
				undefined,
				{
					status: 404,
					statusText: "Not Found",
					headers: new AxiosHeaders(),
					config,
					data: {
						message: "Not found",
						detail: `No route matched: ${config.url}`,
					},
				},
			);
			throw error;
		},
	);
}

/**
 * A mock vscode.Progress implementation that tracks all reported progress.
 * Use this when testing code that accepts a Progress parameter directly.
 */
export class MockProgress<
	T = { message?: string; increment?: number },
> implements vscode.Progress<T> {
	private readonly reports: T[] = [];
	readonly report = vi.fn((value: T) => {
		this.reports.push(value);
	});

	/**
	 * Get all progress reports that have been made.
	 */
	getReports(): readonly T[] {
		return this.reports;
	}

	/**
	 * Clear all recorded reports.
	 */
	clear(): void {
		this.reports.length = 0;
		this.report.mockClear();
	}
}

/**
 * A mock vscode.CancellationToken that can be programmatically cancelled.
 * Use this when testing code that accepts a CancellationToken parameter directly.
 */
export class MockCancellationToken implements vscode.CancellationToken {
	private _isCancellationRequested: boolean;
	private readonly listeners: Array<(e: unknown) => void> = [];

	constructor(initialCancelled = false) {
		this._isCancellationRequested = initialCancelled;
	}

	get isCancellationRequested(): boolean {
		return this._isCancellationRequested;
	}

	onCancellationRequested: vscode.Event<unknown> = (
		listener: (e: unknown) => void,
	) => {
		this.listeners.push(listener);
		// If already cancelled, fire immediately (async to match VS Code behavior)
		if (this._isCancellationRequested) {
			setTimeout(() => listener(undefined), 0);
		}
		return {
			dispose: () => {
				const index = this.listeners.indexOf(listener);
				if (index > -1) {
					this.listeners.splice(index, 1);
				}
			},
		};
	};

	/**
	 * Trigger cancellation. This will:
	 * - Set isCancellationRequested to true
	 * - Fire all registered cancellation listeners
	 */
	cancel(): void {
		if (this._isCancellationRequested) {
			return; // Already cancelled
		}
		this._isCancellationRequested = true;
		for (const listener of this.listeners) {
			listener(undefined);
		}
	}

	/**
	 * Reset to uncancelled state. Useful for reusing the token across tests.
	 */
	reset(): void {
		this._isCancellationRequested = false;
	}
}
