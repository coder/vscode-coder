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
});
