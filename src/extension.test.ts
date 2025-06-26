import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import * as vscodeActual from "vscode";
import * as extension from "./extension";
import {
	createMockExtensionContext,
	createMockRemoteSSHExtension,
	createMockWorkspaceProvider,
	createMockRemote,
	createMockStorage,
	createMockCommands,
	createMockOutputChannel,
} from "./test-helpers";

// Mock dependencies
vi.mock("axios", () => ({
	default: {
		create: vi.fn(() => ({
			defaults: {
				headers: { common: {} },
				baseURL: "https://test.com",
			},
			interceptors: {
				request: { use: vi.fn() },
				response: { use: vi.fn() },
			},
		})),
		getUri: vi.fn(() => "https://test.coder.com/api/v2/user"),
	},
	isAxiosError: vi.fn(),
}));

// Mock module._load for remote SSH extension tests
vi.mock("module", async () => {
	const actual = await vi.importActual<typeof import("module")>("module");
	return {
		...actual,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		_load: vi.fn((request: string, parent: any, isMain: boolean) => {
			// Return mocked vscode when loading from extension path
			if (
				request === "vscode" &&
				parent?.filename?.includes("/path/to/extension")
			) {
				return { test: "proposed", isMocked: true };
			}
			// Otherwise use the actual implementation
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return (actual as any)._load(request, parent, isMain);
		}),
	};
});
vi.mock("coder/site/src/api/api", () => ({
	Api: class MockApi {
		setHost = vi.fn();
		setSessionToken = vi.fn();
		getAxiosInstance = vi.fn(() => ({
			defaults: {
				headers: { common: {} },
				baseURL: "https://test.com",
			},
			interceptors: {
				request: { use: vi.fn() },
				response: { use: vi.fn() },
			},
		}));
	},
}));
vi.mock("./api");
vi.mock("./api-helper", () => ({
	errToStr: vi.fn((error, defaultMessage) => error?.message || defaultMessage),
}));
vi.mock("./commands", () => ({
	Commands: vi.fn(),
}));
vi.mock("./error", () => {
	class MockCertificateError extends Error {
		x509Err?: string;
		showModal = vi.fn();
		constructor(message: string, x509Err?: string) {
			super(message);
			this.x509Err = x509Err;
			this.name = "CertificateError";
		}
	}
	return {
		CertificateError: MockCertificateError,
		getErrorDetail: vi.fn(() => "Some error detail"),
	};
});
vi.mock("./remote", () => ({
	Remote: vi.fn(),
}));
vi.mock("./storage", () => ({
	Storage: vi.fn(),
}));
vi.mock("./util");
vi.mock("./logger", () => ({
	Logger: vi.fn().mockImplementation(() => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	})),
}));
vi.mock("./workspacesProvider", () => ({
	WorkspaceProvider: vi.fn(() => ({
		setVisibility: vi.fn(),
		refresh: vi.fn(),
	})),
	WorkspaceQuery: {
		Mine: "mine",
		All: "all",
	},
}));
vi.mock("./workspaceMonitor", () => ({
	WorkspaceMonitor: vi.fn(),
}));
vi.mock("coder/site/src/api/errors", () => ({
	getErrorMessage: vi.fn(
		(error, defaultMessage) => error?.message || defaultMessage,
	),
}));

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn().mockReturnValue(false), // Return false for autologin to skip that flow
		})),
	},
	window: {
		createOutputChannel: vi.fn(() => ({
			appendLine: vi.fn(),
		})),
		createTreeView: vi.fn(() => ({
			visible: true,
			onDidChangeVisibility: vi.fn(),
		})),
		registerUriHandler: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	commands: {
		registerCommand: vi.fn(),
		executeCommand: vi.fn().mockResolvedValue(undefined),
	},
	extensions: {
		getExtension: vi.fn(),
	},
	env: {
		remoteAuthority: undefined,
	},
	EventEmitter: class MockEventEmitter {
		fire = vi.fn();
		event = vi.fn();
		dispose = vi.fn();
	},
	TreeItem: class MockTreeItem {
		constructor() {
			// Mock implementation
		}
	},
	TreeItemCollapsibleState: {
		None: 0,
		Collapsed: 1,
		Expanded: 2,
	},
}));

beforeEach(() => {
	// Clear all mocks before each test
	vi.clearAllMocks();
});

describe("extension", () => {
	it("should export activate function", () => {
		expect(typeof extension.activate).toBe("function");
	});

	describe("setupRemoteSSHExtension", () => {
		it("should show error message when no remote SSH extension is found", async () => {
			const vscode = await import("vscode");

			// Mock no extension found
			vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined);

			const result = extension.setupRemoteSSHExtension();

			expect(vscodeActual.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Remote SSH extension not found"),
			);
			expect(result.vscodeProposed).toBe(vscode);
			expect(result.remoteSSHExtension).toBeUndefined();
		});

		it("should return vscodeProposed when jeanp413.open-remote-ssh is found", async () => {
			const vscode = await import("vscode");
			const mockExtension = createMockRemoteSSHExtension({
				extensionPath: "/path/to/extension",
			});

			vi.mocked(vscode.extensions.getExtension).mockImplementation((id) => {
				if (id === "jeanp413.open-remote-ssh") {
					return mockExtension as never;
				}
				return undefined;
			});

			const result = extension.setupRemoteSSHExtension();

			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
			expect(result.vscodeProposed).toMatchObject({
				test: "proposed",
				isMocked: true,
			});
			expect(result.remoteSSHExtension).toBe(mockExtension);
		});

		it("should return vscodeProposed when ms-vscode-remote.remote-ssh is found", async () => {
			const vscode = await import("vscode");
			const mockExtension = createMockRemoteSSHExtension({
				extensionPath: "/path/to/extension",
			});

			vi.mocked(vscode.extensions.getExtension).mockImplementation((id) => {
				if (id === "ms-vscode-remote.remote-ssh") {
					return mockExtension as never;
				}
				return undefined;
			});

			const result = extension.setupRemoteSSHExtension();

			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
			expect(result.vscodeProposed).toMatchObject({
				test: "proposed",
				isMocked: true,
			});
			expect(result.remoteSSHExtension).toBe(mockExtension);
		});
	});

	describe("initializeInfrastructure", () => {
		it("should create storage and logger with verbose setting from config", async () => {
			const vscode = await import("vscode");
			const Storage = (await import("./storage")).Storage;
			const Logger = (await import("./logger")).Logger;

			// Mock verbose setting
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn().mockReturnValue(true), // verbose = true
			} as never);

			const mockOutputChannel = createMockOutputChannel();
			const mockContext = createMockExtensionContext({
				globalStorageUri: { fsPath: "/mock/global/storage" } as vscode.Uri,
				logUri: { fsPath: "/mock/log/path" } as vscode.Uri,
			});

			// Track Storage and Logger creation
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let storageInstance: any;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let loggerInstance: any;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(Storage).mockImplementation((...args: any[]) => {
				storageInstance = { args, setLogger: vi.fn() };
				return storageInstance as never;
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.mocked(Logger).mockImplementation((...args: any[]) => {
				loggerInstance = { args };
				return loggerInstance as never;
			});

			const result = await extension.initializeInfrastructure(
				mockContext as never,
				mockOutputChannel as never,
			);

			// Verify Logger was created with verbose setting
			expect(Logger).toHaveBeenCalledWith(mockOutputChannel, { verbose: true });

			// Verify Storage was created with correct args including Logger
			expect(Storage).toHaveBeenCalledWith(
				mockOutputChannel,
				mockContext.globalState,
				mockContext.secrets,
				mockContext.globalStorageUri,
				mockContext.logUri,
				loggerInstance,
			);

			// Verify return value
			expect(result).toEqual({
				storage: storageInstance,
				logger: loggerInstance,
			});
		});

		it("should default verbose to false when not set in config", async () => {
			const vscode = await import("vscode");
			const Logger = (await import("./logger")).Logger;

			// Mock verbose setting not set (returns undefined)
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn().mockReturnValue(undefined),
			} as never);

			const mockOutputChannel = createMockOutputChannel();
			const mockContext = createMockExtensionContext({
				globalStorageUri: { fsPath: "/mock/global/storage" } as vscode.Uri,
				logUri: { fsPath: "/mock/log/path" } as vscode.Uri,
			});

			await extension.initializeInfrastructure(
				mockContext as never,
				mockOutputChannel as never,
			);

			// Verify Logger was created with verbose: false
			expect(Logger).toHaveBeenCalledWith(mockOutputChannel, {
				verbose: false,
			});
		});
	});

	describe("initializeRestClient", () => {
		it("should create REST client with URL and session token from storage", async () => {
			const { makeCoderSdk } = await import("./api");

			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				getSessionToken: vi.fn().mockResolvedValue("test-token-123"),
			};

			const mockRestClient = {
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			};

			vi.mocked(makeCoderSdk).mockResolvedValue(mockRestClient as never);

			const result = await extension.initializeRestClient(mockStorage as never);

			expect(mockStorage.getUrl).toHaveBeenCalled();
			expect(mockStorage.getSessionToken).toHaveBeenCalled();
			expect(makeCoderSdk).toHaveBeenCalledWith(
				"https://test.coder.com",
				"test-token-123",
				mockStorage,
			);
			expect(result).toBe(mockRestClient);
		});

		it("should handle empty URL from storage", async () => {
			const { makeCoderSdk } = await import("./api");

			const mockStorage = {
				getUrl: vi.fn().mockReturnValue(""),
				getSessionToken: vi.fn().mockResolvedValue(""),
			};

			const mockRestClient = {};
			vi.mocked(makeCoderSdk).mockResolvedValue(mockRestClient as never);

			const result = await extension.initializeRestClient(mockStorage as never);

			expect(makeCoderSdk).toHaveBeenCalledWith("", "", mockStorage);
			expect(result).toBe(mockRestClient);
		});
	});

	describe("setupTreeViews", () => {
		it("should create workspace providers and tree views with visibility handlers", async () => {
			const vscode = await import("vscode");
			const { WorkspaceProvider, WorkspaceQuery } = await import(
				"./workspacesProvider"
			);

			const mockRestClient = {};
			const mockStorage = {};

			// Mock workspace providers
			const mockMyWorkspacesProvider = createMockWorkspaceProvider({
				setVisibility: vi.fn(),
				fetchAndRefresh: vi.fn(),
			});
			const mockAllWorkspacesProvider = createMockWorkspaceProvider({
				setVisibility: vi.fn(),
				fetchAndRefresh: vi.fn(),
			});

			vi.mocked(WorkspaceProvider).mockImplementation((query) => {
				if (query === WorkspaceQuery.Mine) {
					return mockMyWorkspacesProvider as never;
				}
				return mockAllWorkspacesProvider as never;
			});

			// Mock tree views
			const mockMyWsTree = {
				visible: true,
				onDidChangeVisibility: vi.fn(),
			};
			const mockAllWsTree = {
				visible: false,
				onDidChangeVisibility: vi.fn(),
			};

			vi.mocked(vscode.window.createTreeView).mockImplementation((viewId) => {
				if (viewId === "myWorkspaces") {
					return mockMyWsTree as never;
				}
				return mockAllWsTree as never;
			});

			const result = extension.setupTreeViews(
				mockRestClient as never,
				mockStorage as never,
			);

			// Verify workspace providers were created
			expect(WorkspaceProvider).toHaveBeenCalledTimes(2);
			expect(WorkspaceProvider).toHaveBeenCalledWith(
				WorkspaceQuery.Mine,
				mockRestClient,
				mockStorage,
				5,
			);
			expect(WorkspaceProvider).toHaveBeenCalledWith(
				WorkspaceQuery.All,
				mockRestClient,
				mockStorage,
			);

			// Verify tree views were created
			expect(vscode.window.createTreeView).toHaveBeenCalledTimes(2);
			expect(vscode.window.createTreeView).toHaveBeenCalledWith(
				"myWorkspaces",
				{
					treeDataProvider: mockMyWorkspacesProvider,
				},
			);
			expect(vscode.window.createTreeView).toHaveBeenCalledWith(
				"allWorkspaces",
				{
					treeDataProvider: mockAllWorkspacesProvider,
				},
			);

			// Verify initial visibility was set
			expect(mockMyWorkspacesProvider.setVisibility).toHaveBeenCalledWith(true);
			expect(mockAllWorkspacesProvider.setVisibility).toHaveBeenCalledWith(
				false,
			);

			// Verify visibility change handlers were registered
			expect(mockMyWsTree.onDidChangeVisibility).toHaveBeenCalled();
			expect(mockAllWsTree.onDidChangeVisibility).toHaveBeenCalled();

			// Test visibility change handlers
			const myVisibilityHandler = vi.mocked(mockMyWsTree.onDidChangeVisibility)
				.mock.calls[0][0];
			const allVisibilityHandler = vi.mocked(
				mockAllWsTree.onDidChangeVisibility,
			).mock.calls[0][0];

			myVisibilityHandler({ visible: false });
			expect(mockMyWorkspacesProvider.setVisibility).toHaveBeenCalledWith(
				false,
			);

			allVisibilityHandler({ visible: true });
			expect(mockAllWorkspacesProvider.setVisibility).toHaveBeenCalledWith(
				true,
			);

			// Verify return value
			expect(result).toEqual({
				myWorkspacesProvider: mockMyWorkspacesProvider,
				allWorkspacesProvider: mockAllWorkspacesProvider,
			});
		});
	});

	describe("registerUriHandler", () => {
		it("should handle /open path with all parameters", async () => {
			const vscode = await import("vscode");
			const { needToken } = await import("./api");
			const { toSafeHost } = await import("./util");

			const mockCommands = {
				maybeAskUrl: vi.fn().mockResolvedValue("https://test.coder.com"),
			};
			const mockRestClient = {
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			};
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://old.coder.com"),
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
				configureCli: vi.fn(),
			};

			// Mock needToken to return true
			vi.mocked(needToken).mockReturnValue(true);
			vi.mocked(toSafeHost).mockReturnValue("test-coder-com");

			// Track the registered handler
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let registeredHandler: any;
			vi.mocked(vscode.window.registerUriHandler).mockImplementation(
				(handler) => {
					registeredHandler = handler;
					return { dispose: vi.fn() };
				},
			);

			extension.registerUriHandler(
				mockCommands as never,
				mockRestClient as never,
				mockStorage as never,
			);

			// Verify handler was registered
			expect(vscode.window.registerUriHandler).toHaveBeenCalled();

			// Test /open path
			const openUri = {
				path: "/open",
				query:
					"owner=testuser&workspace=myws&agent=main&folder=/home/coder&openRecent=true&url=https://test.coder.com&token=test-token",
			};

			await registeredHandler.handleUri(openUri);

			// Verify URL handling
			expect(mockCommands.maybeAskUrl).toHaveBeenCalledWith(
				"https://test.coder.com",
				"https://old.coder.com",
			);
			expect(mockRestClient.setHost).toHaveBeenCalledWith(
				"https://test.coder.com",
			);
			expect(mockStorage.setUrl).toHaveBeenCalledWith("https://test.coder.com");

			// Verify token handling
			expect(mockRestClient.setSessionToken).toHaveBeenCalledWith("test-token");
			expect(mockStorage.setSessionToken).toHaveBeenCalledWith("test-token");

			// Verify CLI configuration
			expect(mockStorage.configureCli).toHaveBeenCalledWith(
				"test-coder-com",
				"https://test.coder.com",
				"test-token",
			);

			// Verify command execution
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.open",
				"testuser",
				"myws",
				"main",
				"/home/coder",
				true,
			);
		});

		it("should handle /openDevContainer path", async () => {
			const vscode = await import("vscode");
			const { needToken } = await import("./api");
			const { toSafeHost } = await import("./util");

			const mockCommands = {
				maybeAskUrl: vi.fn().mockResolvedValue("https://dev.coder.com"),
			};
			const mockRestClient = {
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			};
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue(""),
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
				configureCli: vi.fn(),
			};

			// Mock needToken to return false (non-token auth)
			vi.mocked(needToken).mockReturnValue(false);
			vi.mocked(toSafeHost).mockReturnValue("dev-coder-com");

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let registeredHandler: any;
			vi.mocked(vscode.window.registerUriHandler).mockImplementation(
				(handler) => {
					registeredHandler = handler;
					return { dispose: vi.fn() };
				},
			);

			extension.registerUriHandler(
				mockCommands as never,
				mockRestClient as never,
				mockStorage as never,
			);

			// Test /openDevContainer path
			const devContainerUri = {
				path: "/openDevContainer",
				query:
					"owner=devuser&workspace=devws&agent=main&devContainerName=nodejs&devContainerFolder=/workspace&url=https://dev.coder.com",
			};

			await registeredHandler.handleUri(devContainerUri);

			// Verify URL handling
			expect(mockCommands.maybeAskUrl).toHaveBeenCalledWith(
				"https://dev.coder.com",
				"",
			);
			expect(mockRestClient.setHost).toHaveBeenCalledWith(
				"https://dev.coder.com",
			);
			expect(mockStorage.setUrl).toHaveBeenCalledWith("https://dev.coder.com");

			// Verify no token handling for non-token auth
			expect(mockRestClient.setSessionToken).not.toHaveBeenCalled();
			expect(mockStorage.setSessionToken).not.toHaveBeenCalled();

			// Verify CLI configuration with empty token
			expect(mockStorage.configureCli).toHaveBeenCalledWith(
				"dev-coder-com",
				"https://dev.coder.com",
				"",
			);

			// Verify command execution
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.openDevContainer",
				"devuser",
				"devws",
				"main",
				"nodejs",
				"/workspace",
			);
		});

		it("should throw error for unknown path", async () => {
			const vscode = await import("vscode");

			const mockCommands = {};
			const mockRestClient = {};
			const mockStorage = {};

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let registeredHandler: any;
			vi.mocked(vscode.window.registerUriHandler).mockImplementation(
				(handler) => {
					registeredHandler = handler;
					return { dispose: vi.fn() };
				},
			);

			extension.registerUriHandler(
				mockCommands as never,
				mockRestClient as never,
				mockStorage as never,
			);

			const unknownUri = {
				path: "/unknown",
				query: "",
			};

			await expect(registeredHandler.handleUri(unknownUri)).rejects.toThrow(
				"Unknown path /unknown",
			);
		});

		it("should throw error when required parameters are missing", async () => {
			const vscode = await import("vscode");

			const mockCommands = {};
			const mockRestClient = {};
			const mockStorage = {};

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let registeredHandler: any;
			vi.mocked(vscode.window.registerUriHandler).mockImplementation(
				(handler) => {
					registeredHandler = handler;
					return { dispose: vi.fn() };
				},
			);

			extension.registerUriHandler(
				mockCommands as never,
				mockRestClient as never,
				mockStorage as never,
			);

			// Test missing owner
			const missingOwnerUri = {
				path: "/open",
				query: "workspace=myws",
			};

			await expect(
				registeredHandler.handleUri(missingOwnerUri),
			).rejects.toThrow("owner must be specified as a query parameter");

			// Test missing workspace
			const missingWorkspaceUri = {
				path: "/open",
				query: "owner=testuser",
			};

			await expect(
				registeredHandler.handleUri(missingWorkspaceUri),
			).rejects.toThrow("workspace must be specified as a query parameter");
		});
	});

	describe("registerCommands", () => {
		it("should register all commands with correct handlers", async () => {
			const vscode = await import("vscode");

			const mockCommands = {
				login: vi.fn(),
				logout: vi.fn(),
				open: vi.fn(),
				openDevContainer: vi.fn(),
				openFromSidebar: vi.fn(),
				openAppStatus: vi.fn(),
				updateWorkspace: vi.fn(),
				createWorkspace: vi.fn(),
				navigateToWorkspace: vi.fn(),
				navigateToWorkspaceSettings: vi.fn(),
				viewLogs: vi.fn(),
			};

			const mockMyWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});
			const mockAllWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			// Track registered commands
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const registeredCommands: Record<string, any> = {};
			vi.mocked(vscode.commands.registerCommand).mockImplementation(
				(command, callback) => {
					registeredCommands[command] = callback;
					return { dispose: vi.fn() };
				},
			);

			extension.registerCommands(
				mockCommands as never,
				mockMyWorkspacesProvider as never,
				mockAllWorkspacesProvider as never,
			);

			// Verify all commands were registered
			expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(12);

			// Verify command bindings
			expect(registeredCommands["coder.login"]).toBeDefined();
			expect(registeredCommands["coder.logout"]).toBeDefined();
			expect(registeredCommands["coder.open"]).toBeDefined();
			expect(registeredCommands["coder.openDevContainer"]).toBeDefined();
			expect(registeredCommands["coder.openFromSidebar"]).toBeDefined();
			expect(registeredCommands["coder.openAppStatus"]).toBeDefined();
			expect(registeredCommands["coder.workspace.update"]).toBeDefined();
			expect(registeredCommands["coder.createWorkspace"]).toBeDefined();
			expect(registeredCommands["coder.navigateToWorkspace"]).toBeDefined();
			expect(
				registeredCommands["coder.navigateToWorkspaceSettings"],
			).toBeDefined();
			expect(registeredCommands["coder.viewLogs"]).toBeDefined();
			expect(registeredCommands["coder.refreshWorkspaces"]).toBeDefined();

			// Test that commands are bound correctly
			registeredCommands["coder.login"]();
			expect(mockCommands.login).toHaveBeenCalled();

			registeredCommands["coder.logout"]();
			expect(mockCommands.logout).toHaveBeenCalled();

			// Test refreshWorkspaces command
			registeredCommands["coder.refreshWorkspaces"]();
			expect(mockMyWorkspacesProvider.fetchAndRefresh).toHaveBeenCalled();
			expect(mockAllWorkspacesProvider.fetchAndRefresh).toHaveBeenCalled();
		});
	});

	describe("handleRemoteEnvironment", () => {
		it("should handle remote environment when remoteSSHExtension and remoteAuthority exist", async () => {
			const vscode = await import("vscode");
			const { Remote } = await import("./remote");

			const mockVscodeProposed = {
				env: { remoteAuthority: "test-remote-authority" },
				window: {
					showErrorMessage: vi.fn(),
				},
			} as unknown as typeof vscode;

			const mockRemoteSSHExtension = createMockRemoteSSHExtension({
				extensionPath: "/path/to/extension",
			});

			const mockRestClient = {
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			};

			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			};

			const mockCommands = {};

			const mockContext = createMockExtensionContext({
				extensionMode: 1, // Normal mode
			});

			const mockRemote = createMockRemote({
				setup: vi.fn().mockResolvedValue({
					url: "https://test.coder.com",
					token: "test-token-123",
				}),
				closeRemote: vi.fn(),
			});

			vi.mocked(Remote).mockImplementation(() => mockRemote as never);

			const result = await extension.handleRemoteEnvironment(
				mockVscodeProposed,
				mockRemoteSSHExtension,
				mockRestClient as never,
				mockStorage as never,
				mockCommands as never,
				mockContext,
			);

			expect(Remote).toHaveBeenCalledWith(
				mockVscodeProposed,
				mockStorage,
				mockCommands,
				mockContext.extensionMode,
			);
			expect(mockRemote.setup).toHaveBeenCalledWith("test-remote-authority");
			expect(mockRestClient.setHost).toHaveBeenCalledWith(
				"https://test.coder.com",
			);
			expect(mockRestClient.setSessionToken).toHaveBeenCalledWith(
				"test-token-123",
			);
			expect(result).toBe(true); // Success
		});

		it("should handle CertificateError during remote setup", async () => {
			const vscode = await import("vscode");
			const { Remote } = await import("./remote");

			const mockVscodeProposed = {
				env: { remoteAuthority: "test-remote-authority" },
				window: {
					showErrorMessage: vi.fn(),
				},
			} as unknown as typeof vscode;

			const mockRemoteSSHExtension = createMockRemoteSSHExtension({
				extensionPath: "/path/to/extension",
			});

			const mockRestClient = {};
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			};
			const mockCommands = {};
			const mockContext = createMockExtensionContext({
				extensionMode: 1,
			});

			// Create a mock error that mimics CertificateError
			const mockError = {
				name: "CertificateError",
				message: "Certificate error",
				x509Err: "x509 error details",
				showModal: vi.fn(),
			};

			const mockRemote = createMockRemote({
				setup: vi.fn().mockRejectedValue(mockError),
				closeRemote: vi.fn(),
			});

			vi.mocked(Remote).mockImplementation(() => mockRemote as never);

			const result = await extension.handleRemoteEnvironment(
				mockVscodeProposed,
				mockRemoteSSHExtension,
				mockRestClient as never,
				mockStorage as never,
				mockCommands as never,
				mockContext,
			);

			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"x509 error details",
			);
			expect(mockError.showModal).toHaveBeenCalledWith(
				"Failed to open workspace",
			);
			expect(mockRemote.closeRemote).toHaveBeenCalled();
			expect(result).toBe(false); // Failed
		});

		it("should handle axios error during remote setup", async () => {
			const vscode = await import("vscode");
			const { Remote } = await import("./remote");
			const { isAxiosError } = await import("axios");

			const mockVscodeProposed = {
				env: { remoteAuthority: "test-remote-authority" },
				window: {
					showErrorMessage: vi.fn(),
				},
			} as unknown as typeof vscode;

			const mockRemoteSSHExtension = createMockRemoteSSHExtension({
				extensionPath: "/path/to/extension",
			});

			const mockRestClient = {};
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			};
			const mockCommands = {};
			const mockContext = createMockExtensionContext({
				extensionMode: 1,
			});

			const mockAxiosError = {
				response: { status: 401 },
				config: { method: "get", url: "https://test.coder.com/api/v2/user" },
				message: "Unauthorized",
			};

			vi.mocked(isAxiosError).mockReturnValue(true);

			const mockRemote = createMockRemote({
				setup: vi.fn().mockRejectedValue(mockAxiosError),
				closeRemote: vi.fn(),
			});

			vi.mocked(Remote).mockImplementation(() => mockRemote as never);

			const result = await extension.handleRemoteEnvironment(
				mockVscodeProposed,
				mockRemoteSSHExtension,
				mockRestClient as never,
				mockStorage as never,
				mockCommands as never,
				mockContext,
			);

			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				expect.stringContaining("API GET to"),
			);
			expect(mockVscodeProposed.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to open workspace",
				expect.objectContaining({
					modal: true,
					useCustom: true,
				}),
			);
			expect(mockRemote.closeRemote).toHaveBeenCalled();
			expect(result).toBe(false); // Failed
		});

		it("should skip remote setup when no remoteSSHExtension", async () => {
			const vscode = await import("vscode");

			const mockVscodeProposed = {
				env: { remoteAuthority: "test-remote-authority" },
			} as unknown as typeof vscode;

			const mockRemoteSSHExtension = undefined; // No extension

			const mockRestClient = {};
			const mockStorage = {};
			const mockCommands = {};
			const mockContext = createMockExtensionContext();

			const result = await extension.handleRemoteEnvironment(
				mockVscodeProposed,
				mockRemoteSSHExtension,
				mockRestClient as never,
				mockStorage as never,
				mockCommands as never,
				mockContext,
			);

			expect(result).toBe(true); // Skipped, but successful
		});

		it("should skip remote setup when no remoteAuthority", async () => {
			const vscode = await import("vscode");

			const mockVscodeProposed = {
				env: { remoteAuthority: undefined }, // No remote authority
			} as unknown as typeof vscode;

			const mockRemoteSSHExtension = createMockRemoteSSHExtension({
				extensionPath: "/path/to/extension",
			});

			const mockRestClient = {};
			const mockStorage = {};
			const mockCommands = {};
			const mockContext = createMockExtensionContext();

			const result = await extension.handleRemoteEnvironment(
				mockVscodeProposed,
				mockRemoteSSHExtension,
				mockRestClient as never,
				mockStorage as never,
				mockCommands as never,
				mockContext,
			);

			expect(result).toBe(true); // Skipped, but successful
		});
	});

	describe("checkAuthentication", () => {
		beforeEach(() => {
			// Clear all mocks before each test
			vi.clearAllMocks();
		});

		it("should check authentication when baseUrl exists", async () => {
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "https://test.coder.com" },
				}),
				getAuthenticatedUser: vi.fn().mockResolvedValue({
					username: "test-user",
					roles: [{ name: "member" }],
				}),
			};

			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			};

			const mockMyWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			const mockAllWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			await extension.checkAuthentication(
				mockRestClient as never,
				mockStorage as never,
				mockMyWorkspacesProvider as never,
				mockAllWorkspacesProvider as never,
			);

			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Logged in to https://test.coder.com; checking credentials",
			);
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Credentials are valid",
			);
			expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.authenticated",
				true,
			);
			expect(vscodeActual.commands.executeCommand).not.toHaveBeenCalledWith(
				"setContext",
				"coder.isOwner",
				true,
			);
			expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.loaded",
				true,
			);
			expect(mockMyWorkspacesProvider.fetchAndRefresh).toHaveBeenCalled();
			expect(mockAllWorkspacesProvider.fetchAndRefresh).toHaveBeenCalled();
		});

		it("should set owner context when user has owner role", async () => {
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "https://test.coder.com" },
				}),
				getAuthenticatedUser: vi.fn().mockResolvedValue({
					username: "test-owner",
					roles: [{ name: "owner" }, { name: "member" }],
				}),
			};

			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			};

			const mockMyWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			const mockAllWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			await extension.checkAuthentication(
				mockRestClient as never,
				mockStorage as never,
				mockMyWorkspacesProvider as never,
				mockAllWorkspacesProvider as never,
			);

			expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.authenticated",
				true,
			);
			expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.isOwner",
				true,
			);
			expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.loaded",
				true,
			);
		});

		it("should handle authentication error", async () => {
			const mockError = new Error("Network error");
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "https://test.coder.com" },
				}),
				getAuthenticatedUser: vi.fn().mockRejectedValue(mockError),
			};

			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			};

			const mockMyWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			const mockAllWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			await extension.checkAuthentication(
				mockRestClient as never,
				mockStorage as never,
				mockMyWorkspacesProvider as never,
				mockAllWorkspacesProvider as never,
			);

			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Failed to check user authentication: Network error",
			);
			expect(vscodeActual.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to check user authentication: Network error",
			);
			expect(vscodeActual.commands.executeCommand).not.toHaveBeenCalledWith(
				"setContext",
				"coder.authenticated",
				true,
			);
			expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.loaded",
				true,
			);
			expect(mockMyWorkspacesProvider.fetchAndRefresh).not.toHaveBeenCalled();
			expect(mockAllWorkspacesProvider.fetchAndRefresh).not.toHaveBeenCalled();
		});

		it("should handle unexpected user response", async () => {
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "https://test.coder.com" },
				}),
				getAuthenticatedUser: vi.fn().mockResolvedValue({
					username: "test-user",
					// Missing roles
				}),
			};

			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			};

			const mockMyWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			const mockAllWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			await extension.checkAuthentication(
				mockRestClient as never,
				mockStorage as never,
				mockMyWorkspacesProvider as never,
				mockAllWorkspacesProvider as never,
			);

			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				expect.stringContaining("No error, but got unexpected response:"),
			);
			expect(mockMyWorkspacesProvider.fetchAndRefresh).not.toHaveBeenCalled();
			expect(mockAllWorkspacesProvider.fetchAndRefresh).not.toHaveBeenCalled();
		});

		it("should handle no baseUrl (not logged in)", async () => {
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "" }, // Empty baseURL
				}),
				getAuthenticatedUser: vi.fn(), // Won't be called but needed for type check
			};

			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			};

			const mockMyWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			const mockAllWorkspacesProvider = createMockWorkspaceProvider({
				fetchAndRefresh: vi.fn(),
			});

			await extension.checkAuthentication(
				mockRestClient as never,
				mockStorage as never,
				mockMyWorkspacesProvider as never,
				mockAllWorkspacesProvider as never,
			);

			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Not currently logged in",
			);
			expect(mockRestClient.getAuthenticatedUser).not.toHaveBeenCalled();
			expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.loaded",
				true,
			);
			expect(mockMyWorkspacesProvider.fetchAndRefresh).not.toHaveBeenCalled();
			expect(mockAllWorkspacesProvider.fetchAndRefresh).not.toHaveBeenCalled();
		});
	});

	describe("handleAutologin", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("should execute login command when autologin is enabled and defaultUrl exists", async () => {
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "" }, // No baseURL means not logged in
				}),
			};

			// Mock configuration with autologin enabled
			vi.mocked(vscodeActual.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((key) => {
					if (key === "coder.autologin") {
						return true;
					}
					if (key === "coder.defaultUrl") {
						return "https://auto.coder.com";
					}
					return undefined;
				}),
			} as never);

			await extension.handleAutologin(mockRestClient as never);

			expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
				"coder.login",
				"https://auto.coder.com",
				undefined,
				undefined,
				"true",
			);
		});

		it("should execute login command with CODER_URL env var when defaultUrl not set", async () => {
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "" },
				}),
			};

			// Mock configuration with autologin enabled but no defaultUrl
			vi.mocked(vscodeActual.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((key) => {
					if (key === "coder.autologin") {
						return true;
					}
					if (key === "coder.defaultUrl") {
						return undefined;
					}
					return undefined;
				}),
			} as never);

			// Set environment variable
			const originalEnv = process.env.CODER_URL;
			process.env.CODER_URL = "https://env.coder.com";

			await extension.handleAutologin(mockRestClient as never);

			expect(vscodeActual.commands.executeCommand).toHaveBeenCalledWith(
				"coder.login",
				"https://env.coder.com",
				undefined,
				undefined,
				"true",
			);

			// Restore environment
			if (originalEnv !== undefined) {
				process.env.CODER_URL = originalEnv;
			} else {
				delete process.env.CODER_URL;
			}
		});

		it("should not execute login when autologin is disabled", async () => {
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "" },
				}),
			};

			// Mock configuration with autologin disabled
			vi.mocked(vscodeActual.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((key) => {
					if (key === "coder.autologin") {
						return false;
					}
					if (key === "coder.defaultUrl") {
						return "https://test.coder.com";
					}
					return undefined;
				}),
			} as never);

			await extension.handleAutologin(mockRestClient as never);

			expect(vscodeActual.commands.executeCommand).not.toHaveBeenCalledWith(
				"coder.login",
				expect.anything(),
				expect.anything(),
				expect.anything(),
				expect.anything(),
			);
		});

		it("should not execute login when already authenticated", async () => {
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "https://existing.coder.com" }, // Has baseURL, already logged in
				}),
			};

			// Mock configuration with autologin enabled
			vi.mocked(vscodeActual.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((key) => {
					if (key === "coder.autologin") {
						return true;
					}
					if (key === "coder.defaultUrl") {
						return "https://test.coder.com";
					}
					return undefined;
				}),
			} as never);

			await extension.handleAutologin(mockRestClient as never);

			expect(vscodeActual.commands.executeCommand).not.toHaveBeenCalledWith(
				"coder.login",
				expect.anything(),
				expect.anything(),
				expect.anything(),
				expect.anything(),
			);
		});

		it("should not execute login when no URL is available", async () => {
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "" },
				}),
			};

			// Mock configuration with autologin enabled but no URL
			vi.mocked(vscodeActual.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((key) => {
					if (key === "coder.autologin") {
						return true;
					}
					if (key === "coder.defaultUrl") {
						return undefined;
					}
					return undefined;
				}),
			} as never);

			// Ensure no env var
			const originalEnv = process.env.CODER_URL;
			delete process.env.CODER_URL;

			await extension.handleAutologin(mockRestClient as never);

			expect(vscodeActual.commands.executeCommand).not.toHaveBeenCalledWith(
				"coder.login",
				expect.anything(),
				expect.anything(),
				expect.anything(),
				expect.anything(),
			);

			// Restore environment
			if (originalEnv !== undefined) {
				process.env.CODER_URL = originalEnv;
			}
		});
	});

	describe("activate", () => {
		it("should create output channel when activate is called", async () => {
			const vscode = await import("vscode");

			// Mock extension context
			const mockContext = createMockExtensionContext({
				globalStorageUri: {
					fsPath: "/mock/global/storage",
				} as vscode.Uri,
				logUri: {
					fsPath: "/mock/log/path",
				} as vscode.Uri,
				extensionMode: 1, // Normal mode
			});

			// Mock remote SSH extension not found to trigger error message
			vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined);

			// Mock Storage to return expected values
			const Storage = (await import("./storage")).Storage;
			const mockStorage = createMockStorage();
			vi.mocked(Storage).mockImplementation(() => mockStorage as never);

			// Mock Commands
			const Commands = (await import("./commands")).Commands;
			const mockCommandsInstance = createMockCommands();
			vi.mocked(Commands).mockImplementation(
				() => mockCommandsInstance as never,
			);

			// Mock the makeCoderSdk function to return null to avoid authentication flow
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue({
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "" }, // Empty baseURL to skip auth flow
				})),
			} as never);

			await extension.activate(mockContext);

			// Verify basic initialization steps
			expect(vscode.window.createOutputChannel).toHaveBeenCalledWith("Coder");
			expect(vscodeActual.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Remote SSH extension not found"),
			);
			expect(vscode.window.registerUriHandler).toHaveBeenCalled();
		});

		it("should register URI handler during activation", async () => {
			const vscode = await import("vscode");

			// Mock extension context
			const mockContext = createMockExtensionContext({
				globalStorageUri: {
					fsPath: "/mock/global/storage",
				} as vscode.Uri,
				logUri: {
					fsPath: "/mock/log/path",
				} as vscode.Uri,
				extensionMode: 1, // Normal mode
			});

			// Track if URI handler was registered
			let handlerRegistered = false;
			vi.mocked(vscode.window.registerUriHandler).mockImplementation(() => {
				handlerRegistered = true;
				return { dispose: vi.fn() };
			});

			// Mock Storage to return expected values
			const Storage = (await import("./storage")).Storage;
			const mockStorage = createMockStorage();
			vi.mocked(Storage).mockImplementation(() => mockStorage as never);

			// Mock Commands
			const Commands = (await import("./commands")).Commands;
			const mockCommandsInstance = createMockCommands();
			vi.mocked(Commands).mockImplementation(
				() => mockCommandsInstance as never,
			);

			// Mock makeCoderSdk
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue({
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "" },
				})),
			} as never);

			await extension.activate(mockContext);

			// Verify URI handler was registered
			expect(handlerRegistered).toBe(true);
			expect(vscode.window.registerUriHandler).toHaveBeenCalled();
		});
	});

	// Note: deactivate function is not exported from extension.ts

	describe("Logger integration", () => {
		it("should create Logger and set it on Storage", async () => {
			const vscode = await import("vscode");

			// Track output channel creation
			const mockOutputChannel = {
				appendLine: vi.fn(),
			};
			vi.mocked(vscode.window.createOutputChannel).mockReturnValue(
				mockOutputChannel as never,
			);

			// Mock extension context
			const mockContext = createMockExtensionContext({
				globalStorageUri: {
					fsPath: "/mock/global/storage",
				} as vscode.Uri,
				logUri: {
					fsPath: "/mock/log/path",
				} as vscode.Uri,
				extensionMode: 1, // Normal mode
			});

			// Track Storage instance
			const mockStorage = createMockStorage({
				getUrl: vi.fn().mockReturnValue(""),
				getSessionToken: vi.fn().mockResolvedValue(""),
			});
			const Storage = (await import("./storage")).Storage;
			vi.mocked(Storage).mockImplementation(() => mockStorage as never);

			// Logger is already mocked at the top level
			const { Logger } = await import("./logger");

			// Mock Commands
			const Commands = (await import("./commands")).Commands;
			const mockCommandsInstance = createMockCommands();
			vi.mocked(Commands).mockImplementation(
				() => mockCommandsInstance as never,
			);

			// Mock makeCoderSdk
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue({
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "" },
				})),
			} as never);

			await extension.activate(mockContext);

			// Verify Storage was created
			expect(Storage).toHaveBeenCalled();
			// Verify Logger was created and passed to Storage
			expect(Logger).toHaveBeenCalled();
			const storageCallArgs = vi.mocked(Storage).mock.calls[0];
			expect(storageCallArgs).toHaveLength(6);
			// The 6th argument should be the Logger instance
			expect(storageCallArgs[5]).toEqual(
				expect.objectContaining({
					args: expect.any(Array),
				}),
			);
		});
	});
});
