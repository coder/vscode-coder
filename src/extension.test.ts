import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import * as extension from "./extension";

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
	},
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
vi.mock("./api-helper");
vi.mock("./commands", () => ({
	Commands: vi.fn(),
}));
vi.mock("./error");
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
		executeCommand: vi.fn(),
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

const createMockCommands = () => ({
	login: vi.fn(),
	logout: vi.fn(),
	openFromDashboard: vi.fn(),
	navigateToWorkspace: vi.fn(),
	navigateToAgent: vi.fn(),
	viewAgentLogs: vi.fn(),
	viewLogs: vi.fn(),
	viewDebugLogs: vi.fn(),
	vscodeSsh: vi.fn(),
	createWorkspace: vi.fn(),
	updateWorkspace: vi.fn(),
	open: vi.fn(),
	reloadWindow: vi.fn(),
	refreshWorkspaces: vi.fn(),
	navigateToWorkspaceSettings: vi.fn(),
	openDevContainer: vi.fn(),
	openFromSidebar: vi.fn(),
	openAppStatus: vi.fn(),
});

const createMockStorage = (overrides = {}) => ({
	getUrl: vi.fn().mockReturnValue(""),
	getSessionToken: vi.fn().mockResolvedValue(""),
	writeToCoderOutputChannel: vi.fn(),
	setLogger: vi.fn(),
	...overrides,
});

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

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Remote SSH extension not found"),
			);
			expect(result.vscodeProposed).toBe(vscode);
			expect(result.remoteSSHExtension).toBeUndefined();
		});

		it("should return vscodeProposed when jeanp413.open-remote-ssh is found", async () => {
			const vscode = await import("vscode");
			const mockExtension = {
				extensionPath: "/path/to/extension",
			};

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
			const mockExtension = {
				extensionPath: "/path/to/extension",
			};

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

			const mockOutputChannel = {
				appendLine: vi.fn(),
			};
			const mockContext = {
				globalState: { get: vi.fn(), update: vi.fn() },
				secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
				globalStorageUri: { fsPath: "/mock/global/storage" },
				logUri: { fsPath: "/mock/log/path" },
			};

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

			// Verify Storage was created with correct args
			expect(Storage).toHaveBeenCalledWith(
				mockOutputChannel,
				mockContext.globalState,
				mockContext.secrets,
				mockContext.globalStorageUri,
				mockContext.logUri,
			);

			// Verify Logger was created with verbose setting
			expect(Logger).toHaveBeenCalledWith(mockOutputChannel, { verbose: true });

			// Verify setLogger was called
			expect(storageInstance.setLogger).toHaveBeenCalledWith(loggerInstance);

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

			const mockOutputChannel = { appendLine: vi.fn() };
			const mockContext = {
				globalState: { get: vi.fn(), update: vi.fn() },
				secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
				globalStorageUri: { fsPath: "/mock/global/storage" },
				logUri: { fsPath: "/mock/log/path" },
			};

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
			const mockMyWorkspacesProvider = {
				setVisibility: vi.fn(),
				fetchAndRefresh: vi.fn(),
			};
			const mockAllWorkspacesProvider = {
				setVisibility: vi.fn(),
				fetchAndRefresh: vi.fn(),
			};

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

	describe("activate", () => {
		it("should create output channel when activate is called", async () => {
			const vscode = await import("vscode");

			// Mock extension context
			const mockContext = {
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				secrets: {
					get: vi.fn(),
					store: vi.fn(),
					delete: vi.fn(),
				},
				globalStorageUri: {
					fsPath: "/mock/global/storage",
				},
				logUri: {
					fsPath: "/mock/log/path",
				},
				extensionMode: 1, // Normal mode
			};

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

			await extension.activate(
				mockContext as unknown as vscode.ExtensionContext,
			);

			// Verify basic initialization steps
			expect(vscode.window.createOutputChannel).toHaveBeenCalledWith("Coder");
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Remote SSH extension not found"),
			);
			expect(vscode.window.registerUriHandler).toHaveBeenCalled();
		});

		it("should register URI handler during activation", async () => {
			const vscode = await import("vscode");

			// Mock extension context
			const mockContext = {
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				secrets: {
					get: vi.fn(),
					store: vi.fn(),
					delete: vi.fn(),
				},
				globalStorageUri: {
					fsPath: "/mock/global/storage",
				},
				logUri: {
					fsPath: "/mock/log/path",
				},
				extensionMode: 1, // Normal mode
			};

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

			await extension.activate(
				mockContext as unknown as vscode.ExtensionContext,
			);

			// Verify URI handler was registered
			expect(handlerRegistered).toBe(true);
			expect(vscode.window.registerUriHandler).toHaveBeenCalled();
		});
	});

	describe.skip("activate - remote environment", () => {
		it("should handle remote environment with existing workspace", async () => {
			const vscode = await import("vscode");

			// Set remote environment
			Object.defineProperty(vscode.env, "remoteAuthority", {
				value: "test-remote",
				configurable: true,
			});

			// Mock Remote class
			const Remote = (await import("./remote")).Remote;
			const mockRemote = {
				setupRemote: vi.fn().mockResolvedValue({ id: "workspace-123" }),
			};
			vi.mocked(Remote).mockImplementation(() => mockRemote as never);

			// Mock extension context
			const mockContext = {
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				secrets: {
					get: vi.fn(),
					store: vi.fn(),
					delete: vi.fn(),
				},
				globalStorageUri: {
					fsPath: "/mock/global/storage",
				},
				logUri: {
					fsPath: "/mock/log/path",
				},
				extensionMode: 1,
				subscriptions: [],
			};

			// Mock Storage
			const Storage = (await import("./storage")).Storage;
			const mockStorage = createMockStorage({
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				getSessionToken: vi.fn().mockResolvedValue("test-token"),
			});
			vi.mocked(Storage).mockImplementation(() => mockStorage as never);

			// Mock makeCoderSdk
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue({
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.coder.com" },
				})),
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
				getAuthenticatedUser: vi.fn().mockResolvedValue({
					username: "test-user",
					roles: ["admin"],
				}),
			} as never);

			// Mock Commands
			const Commands = (await import("./commands")).Commands;
			const mockCommandsInstance = createMockCommands();
			vi.mocked(Commands).mockImplementation(
				() => mockCommandsInstance as never,
			);

			// Mock workspace monitor
			const WorkspaceMonitor = (await import("./workspaceMonitor"))
				.WorkspaceMonitor;
			vi.mocked(WorkspaceMonitor).mockImplementation(
				() =>
					({
						dispose: vi.fn(),
					}) as never,
			);

			await extension.activate(
				mockContext as unknown as vscode.ExtensionContext,
			);

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Verify remote setup was called
			expect(mockRemote.setupRemote).toHaveBeenCalled();
			expect(WorkspaceMonitor).toHaveBeenCalled();

			// Reset remote authority
			Object.defineProperty(vscode.env, "remoteAuthority", {
				value: undefined,
				configurable: true,
			});
		});
	});

	describe.skip("activate - autologin flow", () => {
		it("should attempt autologin when configured", async () => {
			const vscode = await import("vscode");

			// Mock autologin configuration to true
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn().mockReturnValue(true), // Enable autologin
			} as never);

			// Mock extension context
			const mockContext = {
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				secrets: {
					get: vi.fn(),
					store: vi.fn(),
					delete: vi.fn(),
				},
				globalStorageUri: {
					fsPath: "/mock/global/storage",
				},
				logUri: {
					fsPath: "/mock/log/path",
				},
				extensionMode: 1,
				subscriptions: [],
			};

			// Mock Storage to return expected values
			const Storage = (await import("./storage")).Storage;
			const mockStorage = createMockStorage({
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				getSessionToken: vi.fn().mockResolvedValue("test-token"),
			});
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
					defaults: { baseURL: "https://test.coder.com" },
				})),
				getAuthenticatedUser: vi.fn().mockResolvedValue({
					username: "test-user",
					roles: ["admin"],
				}),
			} as never);

			await extension.activate(
				mockContext as unknown as vscode.ExtensionContext,
			);

			// Wait for async operations to complete
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Verify login was called due to autologin
			expect(mockCommandsInstance.login).toHaveBeenCalled();
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
			const mockContext = {
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				secrets: {
					get: vi.fn(),
					store: vi.fn(),
					delete: vi.fn(),
				},
				globalStorageUri: {
					fsPath: "/mock/global/storage",
				},
				logUri: {
					fsPath: "/mock/log/path",
				},
				extensionMode: 1, // Normal mode
			};

			// Track Storage instance and setLogger call
			let setLoggerCalled = false;
			let storageInstance = createMockStorage();
			const Storage = (await import("./storage")).Storage;
			vi.mocked(Storage).mockImplementation(() => {
				storageInstance = createMockStorage({
					setLogger: vi.fn(() => {
						setLoggerCalled = true;
					}),
					getUrl: vi.fn().mockReturnValue(""),
					getSessionToken: vi.fn().mockResolvedValue(""),
				});
				return storageInstance as never;
			});

			// Logger is already mocked at the top level

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

			await extension.activate(
				mockContext as unknown as vscode.ExtensionContext,
			);

			// Verify Storage was created
			expect(Storage).toHaveBeenCalled();

			// Verify setLogger was called on Storage
			expect(setLoggerCalled).toBe(true);
			expect(storageInstance.setLogger).toHaveBeenCalled();
		});
	});
});
