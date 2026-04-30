import axios, {
	AxiosError,
	AxiosHeaders,
	type AxiosAdapter,
	type AxiosResponse,
	type InternalAxiosRequestConfig,
} from "axios";
import { vi } from "vitest";
import * as vscode from "vscode";

import { window as vscodeWindow } from "./vscode.runtime";

import type { Experiment, User } from "coder/site/src/api/typesGenerated";
import type { WebSocketEventType } from "coder/site/src/utils/OneWayWebSocket";
import type { IncomingMessage } from "node:http";

import type { CoderApi } from "@/api/coderApi";
import type { CliCredentialManager } from "@/core/cliCredentialManager";
import type { Logger } from "@/logging/logger";
import type { NetworkInfo } from "@/remote/sshProcess";
import type {
	EventHandler,
	EventPayloadMap,
	ParsedMessageEvent,
	UnidirectionalStream,
} from "@/websocket/eventStreamConnection";

export function makeNetworkInfo(
	overrides: Partial<NetworkInfo> = {},
): NetworkInfo {
	return {
		p2p: true,
		latency: 50,
		preferred_derp: "NYC",
		derp_latency: { NYC: 10 },
		upload_bytes_sec: 1_250_000,
		download_bytes_sec: 6_250_000,
		using_coder_connect: false,
		...overrides,
	};
}

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

/** A recorded call to one of the vscode.window.show*Message methods. */
export interface MessageCall {
	level: "information" | "warning" | "error";
	message: string;
	items: string[];
}

/**
 * Mock user interaction that integrates with vscode.window message dialogs and input boxes.
 * Use this to control user responses and inspect dialog calls in tests.
 */
export class MockUserInteraction {
	private readonly responses = new Map<string, string | undefined>();
	private readonly _messageCalls: MessageCall[] = [];
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
	 * Get all message dialog calls that were made (across all levels).
	 */
	getMessageCalls(): readonly MessageCall[] {
		return this._messageCalls;
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
		this._messageCalls.length = 0;
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

		const handleMessage =
			(level: MessageCall["level"]) =>
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- serves all show*Message overloads
			(message: string, ...rest: unknown[]): Thenable<any> => {
				const items = rest.filter(
					(arg): arg is string => typeof arg === "string",
				);
				this._messageCalls.push({ level, message, items });
				return Promise.resolve(getResponse(message));
			};

		vi.mocked(vscode.window.showErrorMessage).mockImplementation(
			handleMessage("error"),
		);

		vi.mocked(vscode.window.showWarningMessage).mockImplementation(
			handleMessage("warning"),
		);

		vi.mocked(vscode.window.showInformationMessage).mockImplementation(
			handleMessage("information"),
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

export function createMockCliCredentialManager(): CliCredentialManager {
	return {
		storeToken: vi.fn().mockResolvedValue(undefined),
		readToken: vi.fn().mockResolvedValue(undefined),
		deleteToken: vi.fn().mockResolvedValue(undefined),
	} as unknown as CliCredentialManager;
}

export function createMockLogger(): Logger {
	return {
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		show: vi.fn(),
	};
}

/** Update the mocked active color theme and fire onDidChangeActiveColorTheme. */
export function setActiveColorTheme(kind: vscode.ColorThemeKind): void {
	vscodeWindow.__setActiveColorThemeKind(kind);
}

/** Hooks to drive lifecycle and inspect messages on a mocked WebviewPanel. */
export interface WebviewPanelTestHooks {
	setVisible(visible: boolean): void;
	fireDispose(): void;
	sendFromWebview(msg: unknown): void;
	readonly postedMessages: readonly unknown[];
}

/**
 * Build a WebviewPanel for tests. Signature matches
 * vscode.window.createWebviewPanel so it drops in via mockImplementation.
 */
export function createMockWebviewPanel(
	viewType: string,
	title: string,
	showOptions:
		| vscode.ViewColumn
		| {
				readonly viewColumn: vscode.ViewColumn;
				readonly preserveFocus?: boolean;
		  },
	options?: vscode.WebviewPanelOptions & vscode.WebviewOptions,
): { panel: vscode.WebviewPanel; hooks: WebviewPanelTestHooks } {
	const viewStateEmitter =
		new vscode.EventEmitter<vscode.WebviewPanelOnDidChangeViewStateEvent>();
	const disposeEmitter = new vscode.EventEmitter<void>();
	const messageEmitter = new vscode.EventEmitter<unknown>();

	const viewColumn =
		typeof showOptions === "object" ? showOptions.viewColumn : showOptions;
	const postedMessages: unknown[] = [];
	let visible = true;

	const webview: vscode.Webview = {
		options: options ?? { enableScripts: true, localResourceRoots: [] },
		html: "",
		cspSource: "mock-csp",
		onDidReceiveMessage: messageEmitter.event,
		postMessage: (msg) => {
			postedMessages.push(msg);
			return Promise.resolve(true);
		},
		asWebviewUri: (uri) => uri,
	};

	const panel: vscode.WebviewPanel = {
		viewType,
		title,
		iconPath: undefined,
		webview,
		options: options ?? {},
		get viewColumn() {
			return viewColumn;
		},
		get active() {
			return visible;
		},
		get visible() {
			return visible;
		},
		onDidChangeViewState: viewStateEmitter.event,
		onDidDispose: disposeEmitter.event,
		reveal: () => undefined,
		dispose: () => disposeEmitter.fire(),
	};

	const hooks: WebviewPanelTestHooks = {
		setVisible(next) {
			visible = next;
			viewStateEmitter.fire({ webviewPanel: panel });
		},
		fireDispose() {
			disposeEmitter.fire();
		},
		sendFromWebview(msg) {
			messageEmitter.fire(msg);
		},
		postedMessages,
	};

	return { panel, hooks };
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
export class MockStatusBarItem implements vscode.StatusBarItem {
	readonly id = "mock-status-bar";
	text = "";
	tooltip: string | vscode.MarkdownString | undefined = "";
	backgroundColor: vscode.ThemeColor | undefined;
	color: string | vscode.ThemeColor | undefined;
	command: string | vscode.Command | undefined;
	accessibilityInformation: vscode.AccessibilityInformation | undefined;
	name: string | undefined;
	readonly priority: number | undefined = undefined;
	readonly alignment: vscode.StatusBarAlignment =
		vscode.StatusBarAlignment.Left;

	readonly show = vi.fn();
	readonly hide = vi.fn();
	readonly dispose = vi.fn();

	constructor() {
		vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(this);
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
	| "getSessionToken"
	| "getAuthenticatedUser"
	| "dispose"
	| "getExperiments"
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
	readonly getSessionToken = vi.fn(() => this._token);

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

	readonly getExperiments = vi.fn(
		(): Promise<Experiment[]> => Promise.resolve([]),
	);

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
		has_ai_seat: false,
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

/**
 * Mock event stream that implements UnidirectionalStream directly.
 * Use pushMessage/pushError for common cases, or emit() for any event type.
 */
export class MockEventStream<T> implements UnidirectionalStream<T> {
	readonly url = "ws://test/mock-stream";
	readonly close = vi.fn();

	private readonly handlers = new Map<
		string,
		Set<(...args: unknown[]) => void>
	>();

	addEventListener<E extends WebSocketEventType>(
		event: E,
		callback: EventHandler<T, E>,
	): void {
		if (!this.handlers.has(event)) {
			this.handlers.set(event, new Set());
		}
		this.handlers.get(event)!.add(callback as (...args: unknown[]) => void);
	}

	removeEventListener<E extends WebSocketEventType>(
		event: E,
		callback: EventHandler<T, E>,
	): void {
		this.handlers.get(event)?.delete(callback as (...args: unknown[]) => void);
	}

	emit<E extends WebSocketEventType>(
		event: E,
		payload: EventPayloadMap<T>[E],
	): void {
		const handlers = this.handlers.get(event);
		if (handlers) {
			for (const handler of handlers) {
				handler(payload);
			}
		}
	}

	pushMessage(parsedMessage: T): void {
		const payload: ParsedMessageEvent<T> = {
			sourceEvent: { data: undefined },
			parsedMessage,
			parseError: undefined,
		};
		this.emit("message", payload);
	}

	pushError(error: Error): void {
		const payload: ParsedMessageEvent<T> = {
			sourceEvent: { data: undefined },
			parsedMessage: undefined,
			parseError: error,
		};
		this.emit("message", payload);
	}
}

/**
 * Mock ContextManager that stores values and tracks `set` calls.
 */
export class MockContextManager {
	private readonly contexts = new Map<string, boolean>();

	readonly set = vi.fn((key: string, value: boolean) => {
		this.contexts.set(key, value);
	});

	get(key: string): boolean {
		return this.contexts.get(key) ?? false;
	}

	readonly dispose = vi.fn();
}

/** Mock VS Code OutputChannel that captures all appended content. */
export class MockOutputChannel implements vscode.LogOutputChannel {
	readonly name: string;
	readonly logLevel = vscode.LogLevel.Info;
	readonly onDidChangeLogLevel: vscode.Event<vscode.LogLevel> = vi.fn();

	private _content: string[] = [];

	constructor(name = "mock") {
		this.name = name;
	}

	get content(): string[] {
		return this._content;
	}

	append = vi.fn((value: string) => this._content.push(value));
	appendLine = vi.fn((value: string) => this._content.push(value + "\n"));
	replace = vi.fn((value: string) => {
		this._content = [value];
	});
	clear = vi.fn(() => {
		this._content = [];
	});
	dispose = vi.fn(() => {
		this._content = [];
	});
	show = vi.fn();
	hide = vi.fn();
	trace = vi.fn();
	debug = vi.fn();
	info = vi.fn();
	warn = vi.fn();
	error = vi.fn();
}

/**
 * Mock TerminalOutputChannel that captures all written content.
 * Use `lastInstance` to get the most recently created instance (set in the constructor),
 * which is useful when the real class is created inside the class under test.
 */
export class MockTerminalOutputChannel {
	static lastInstance: MockTerminalOutputChannel | undefined;

	private readonly _lines: string[] = [];

	readonly write = vi.fn((data: string) => {
		this._lines.push(data);
	});
	readonly dispose = vi.fn();

	constructor(_name?: string) {
		MockTerminalOutputChannel.lastInstance = this;
	}

	/** All lines written via write(). */
	get lines(): readonly string[] {
		return this._lines;
	}

	/** Concatenated content. */
	get content(): string {
		return this._lines.join("");
	}

	/** Reset captured content and mock call history. */
	clear(): void {
		this._lines.length = 0;
		this.write.mockClear();
	}
}
