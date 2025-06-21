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
vi.mock("./commands");
vi.mock("./error");
vi.mock("./remote");
vi.mock("./storage");
vi.mock("./util");
vi.mock("./workspacesProvider");

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
	});

	// Note: deactivate function is not exported from extension.ts
});
