import { describe, it, expect, vi, beforeAll } from "vitest";
import * as vscode from "vscode";
import { Commands } from "./commands";
import {
	createMockOutputChannelWithLogger,
	createMockVSCode,
	createMockApi,
	createMockStorage,
	createMockStorageWithAuth,
	createMockWorkspace,
	createMockAgent,
	createTestUIProvider,
	createMockConfiguration,
	createMockQuickPick,
} from "./test-helpers";
import { OpenableTreeItem } from "./workspacesProvider";

// Mock dependencies
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./error");
vi.mock("./storage");
vi.mock("./util");
vi.mock("./workspacesProvider");
vi.mock("coder/site/src/api/errors", () => ({
	getErrorMessage: vi.fn((error: unknown, defaultMessage: string) => {
		if (error instanceof Error) {
			return error.message;
		}
		return defaultMessage;
	}),
}));

beforeAll(() => {
	vi.mock("vscode", () => {
		const mockConfiguration = {
			get: vi.fn((key) => {
				if (key === "coder.defaultUrl") {
					return "";
				}
				return undefined;
			}),
		};
		return {
			window: {
				showInformationMessage: vi.fn().mockResolvedValue(undefined),
				showInputBox: vi.fn(),
				createQuickPick: vi.fn(),
				showTextDocument: vi.fn(),
				withProgress: vi.fn((options, task) => task()),
				createTerminal: vi.fn(() => ({
					sendText: vi.fn(),
					show: vi.fn(),
				})),
			},
			workspace: {
				openTextDocument: vi.fn(),
				workspaceFolders: [],
				getConfiguration: vi.fn(() => mockConfiguration),
			},
			Uri: {
				file: vi.fn(),
				from: vi.fn((obj) => obj),
				parse: vi.fn((url) => ({ toString: () => url })),
			},
			commands: {
				executeCommand: vi.fn(),
			},
			env: {
				openExternal: vi.fn().mockResolvedValue(true),
			},
			ProgressLocation: {
				Notification: 15,
			},
			EventEmitter: class {
				event = vi.fn();
			},
		};
	});
});

describe("commands", () => {
	it("should create Commands instance", () => {
		const mockVscodeProposed = createMockVSCode();
		const mockRestClient = createMockApi();
		const mockStorage = createMockStorage();
		const { uiProvider } = createTestUIProvider();

		const commands = new Commands(
			mockVscodeProposed,
			mockRestClient,
			mockStorage,
			uiProvider,
		);

		expect(commands).toBeInstanceOf(Commands);
		expect(commands.workspace).toBeUndefined();
		expect(commands.workspaceLogPath).toBeUndefined();
		expect(commands.workspaceRestClient).toBeUndefined();
	});

	describe("maybeAskAgent", () => {
		it("should throw error when no matching agents", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();
			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Mock extractAgents to return empty array
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([]);

			const mockWorkspace = createMockWorkspace({ id: "test-workspace" });

			await expect(commands.maybeAskAgent(mockWorkspace)).rejects.toThrow(
				"Workspace has no matching agents",
			);
		});

		it("should return single agent when only one exists", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();
			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const mockAgent = createMockAgent({
				id: "agent-1",
				name: "main",
				status: "connected",
			});

			// Mock extractAgents to return single agent
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([mockAgent]);

			const mockWorkspace = createMockWorkspace({ id: "test-workspace" });

			const result = await commands.maybeAskAgent(mockWorkspace);
			expect(result).toBe(mockAgent);
		});

		it("should filter agents by name when filter provided", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();
			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const mainAgent = createMockAgent({
				id: "agent-1",
				name: "main",
				status: "connected",
			});

			const gpuAgent = createMockAgent({
				id: "agent-2",
				name: "gpu",
				status: "connected",
			});

			// Mock extractAgents to return multiple agents
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([mainAgent, gpuAgent]);

			const mockWorkspace = createMockWorkspace({ id: "test-workspace" });

			// Should return gpu agent when filtered by name
			const result = await commands.maybeAskAgent(mockWorkspace, "gpu");
			expect(result).toBe(gpuAgent);
		});
	});

	describe("viewLogs", () => {
		it("should show info message when no log path is set", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();
			const { uiProvider, getShownMessages } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Ensure workspaceLogPath is undefined
			commands.workspaceLogPath = undefined;

			await commands.viewLogs();

			const shownMessages = getShownMessages();
			expect(shownMessages).toHaveLength(1);
			expect(shownMessages[0]).toMatchObject({
				type: "info",
				message:
					"No logs available. Make sure to set coder.proxyLogDirectory to get logs.",
				items: ["<unset>"],
			});
		});

		it("should open log file when log path is set", async () => {
			// Mock vscode methods
			const mockDocument = { uri: "test-doc-uri" };
			const openTextDocumentMock = vi.fn().mockResolvedValue(mockDocument);
			const showTextDocumentMock = vi.fn();
			const fileMock = vi.fn().mockReturnValue("file://test-log-path");

			vi.mocked(vscode.workspace.openTextDocument).mockImplementation(
				openTextDocumentMock,
			);
			vi.mocked(vscode.window.showTextDocument).mockImplementation(
				showTextDocumentMock,
			);
			vi.mocked(vscode.Uri.file).mockImplementation(fileMock);

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();
			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Set workspaceLogPath
			commands.workspaceLogPath = "/path/to/log.txt";

			await commands.viewLogs();

			expect(fileMock).toHaveBeenCalledWith("/path/to/log.txt");
			expect(openTextDocumentMock).toHaveBeenCalledWith("file://test-log-path");
			expect(showTextDocumentMock).toHaveBeenCalledWith(mockDocument);
		});
	});

	describe("logout", () => {
		it("should clear auth state and show info message", async () => {
			// Mock vscode methods
			const showInformationMessageMock = vi.fn().mockResolvedValue(undefined);
			vi.mocked(vscode.window.showInformationMessage).mockImplementation(
				showInformationMessageMock,
			);
			const executeCommandMock = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandMock,
			);

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi({
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			});
			const mockStorage = createMockStorage({
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
			});

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			await commands.logout();

			// Verify storage was cleared
			expect(mockStorage.setUrl).toHaveBeenCalledWith(undefined);
			expect(mockStorage.setSessionToken).toHaveBeenCalledWith(undefined);

			// Verify REST client was reset
			expect(mockRestClient.setHost).toHaveBeenCalledWith("");
			expect(mockRestClient.setSessionToken).toHaveBeenCalledWith("");

			// Verify context was set
			expect(executeCommandMock).toHaveBeenCalledWith(
				"setContext",
				"coder.authenticated",
				false,
			);

			// Verify workspaces were refreshed
			expect(executeCommandMock).toHaveBeenCalledWith(
				"coder.refreshWorkspaces",
			);

			// Verify info message was shown
			expect(showInformationMessageMock).toHaveBeenCalledWith(
				"You've been logged out of Coder!",
				"Login",
			);
		});
	});

	describe("navigateToWorkspace", () => {
		it("should open workspace URL when workspace is provided", async () => {
			const executeCommandMock = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandMock,
			);

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const mockWorkspace = {
				workspaceOwner: "testuser",
				workspaceName: "my-workspace",
			} as OpenableTreeItem;

			await commands.navigateToWorkspace(mockWorkspace);

			expect(executeCommandMock).toHaveBeenCalledWith(
				"vscode.open",
				"https://test.coder.com/@testuser/my-workspace",
			);
		});

		it("should show info message when no workspace is provided and not connected", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider, getShownMessages } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Ensure workspace and workspaceRestClient are undefined
			commands.workspace = undefined;
			commands.workspaceRestClient = undefined;

			await commands.navigateToWorkspace(
				undefined as unknown as OpenableTreeItem,
			);

			const shownMessages = getShownMessages();
			expect(shownMessages).toHaveLength(1);
			expect(shownMessages[0]).toMatchObject({
				type: "info",
				message: "No workspace found.",
			});
		});
	});

	describe("navigateToWorkspaceSettings", () => {
		it("should open workspace settings URL when workspace is provided", async () => {
			const executeCommandMock = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandMock,
			);

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const mockWorkspace = {
				workspaceOwner: "testuser",
				workspaceName: "my-workspace",
			} as OpenableTreeItem;

			await commands.navigateToWorkspaceSettings(mockWorkspace);

			expect(executeCommandMock).toHaveBeenCalledWith(
				"vscode.open",
				"https://test.coder.com/@testuser/my-workspace/settings",
			);
		});

		it("should use current workspace when none provided and connected", async () => {
			const executeCommandMock = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandMock,
			);

			const mockVscodeProposed = createMockVSCode();
			const mockAxiosInstance = {
				defaults: {
					baseURL: "https://connected.coder.com",
				},
			};
			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn().mockReturnValue(mockAxiosInstance),
			});
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Set up connected workspace
			commands.workspace = createMockWorkspace({
				owner_name: "connecteduser",
				name: "connected-workspace",
			});
			commands.workspaceRestClient = mockRestClient;

			await commands.navigateToWorkspaceSettings(
				undefined as unknown as OpenableTreeItem,
			);

			expect(executeCommandMock).toHaveBeenCalledWith(
				"vscode.open",
				"https://connected.coder.com/@connecteduser/connected-workspace/settings",
			);
		});
	});

	describe("createWorkspace", () => {
		it("should open templates URL", async () => {
			const executeCommandMock = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandMock,
			);

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			await commands.createWorkspace();

			expect(executeCommandMock).toHaveBeenCalledWith(
				"vscode.open",
				"https://test.coder.com/templates",
			);
		});
	});

	describe("maybeAskUrl", () => {
		it("should return undefined when user aborts", async () => {
			const mockConfiguration = createMockConfiguration({
				"coder.defaultUrl": "",
			});
			const mockVscodeProposed = createMockVSCode();
			vi.mocked(mockVscodeProposed.workspace.getConfiguration).mockReturnValue(
				mockConfiguration,
			);

			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Mock the window.createQuickPick to return our test quick pick
			const quickPick = createMockQuickPick();
			let onDidHideHandler: (() => void) | undefined;
			quickPick.onDidHide = vi.fn((handler) => {
				onDidHideHandler = handler;
				return { dispose: vi.fn() };
			});
			quickPick.show = vi.fn(() => {
				// Simulate user pressing escape to cancel
				setTimeout(() => {
					quickPick.hide();
					if (onDidHideHandler) {
						onDidHideHandler();
					}
				}, 0);
			});
			vi.mocked(uiProvider.createQuickPick).mockReturnValue(quickPick);

			const result = await commands.maybeAskUrl(null);

			expect(result).toBeUndefined();
		});

		it("should normalize URL with https prefix when missing", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const result = await commands.maybeAskUrl("example.coder.com");

			expect(result).toBe("https://example.coder.com");
		});

		it("should remove trailing slashes", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const result = await commands.maybeAskUrl("https://example.coder.com///");

			expect(result).toBe("https://example.coder.com");
		});
	});

	describe("updateWorkspace", () => {
		it("should do nothing when no workspace is active", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Ensure workspace and workspaceRestClient are undefined
			commands.workspace = undefined;
			commands.workspaceRestClient = undefined;

			await commands.updateWorkspace();

			// Should not show any message when no workspace
			expect(
				mockVscodeProposed.window.showInformationMessage,
			).not.toHaveBeenCalled();
		});

		it("should prompt for confirmation and update workspace when user confirms", async () => {
			const updateWorkspaceVersionMock = vi.fn().mockResolvedValue(undefined);

			const mockVscodeProposed = createMockVSCode();

			const mockWorkspaceRestClient = createMockApi({
				updateWorkspaceVersion: updateWorkspaceVersionMock,
			});

			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider, addMessageResponse, getShownMessages } =
				createTestUIProvider();
			// Program the UI provider to return "Update" when prompted
			addMessageResponse("Update");

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Set up active workspace
			const mockWorkspace = createMockWorkspace({
				owner_name: "testuser",
				name: "my-workspace",
			});
			commands.workspace = mockWorkspace;
			commands.workspaceRestClient = mockWorkspaceRestClient;

			await commands.updateWorkspace();

			// Verify confirmation dialog was shown
			const shownMessages = getShownMessages();
			expect(shownMessages).toHaveLength(1);
			expect(shownMessages[0]).toMatchObject({
				type: "info",
				message: "Update Workspace",
				options: {
					useCustom: true,
					modal: true,
					detail: "Update testuser/my-workspace to the latest version?",
				},
				items: ["Update"],
			});

			// Verify workspace was updated
			expect(updateWorkspaceVersionMock).toHaveBeenCalledWith(mockWorkspace);
		});
	});

	describe("openFromSidebar", () => {
		it("should throw error when not logged in", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "" }, // Empty baseURL indicates not logged in
				}),
			});
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const mockTreeItem = {
				workspaceOwner: "testuser",
				workspaceName: "my-workspace",
			} as OpenableTreeItem;

			await expect(commands.openFromSidebar(mockTreeItem)).rejects.toThrow(
				"You are not logged in",
			);
		});
	});

	describe("login", () => {
		it("should abort when user cancels URL selection", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Mock maybeAskUrl to return undefined (user cancelled)
			const maybeAskUrlSpy = vi
				.spyOn(commands, "maybeAskUrl")
				.mockResolvedValue(undefined);

			await commands.login();

			expect(maybeAskUrlSpy).toHaveBeenCalledWith(undefined);
			// Should not proceed to ask for token
		});

		it("should complete login successfully with provided URL and token", async () => {
			const executeCommandMock = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandMock,
			);
			// Mock showInformationMessage to return a resolved promise
			vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
				undefined,
			);

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi({
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			});
			const mockStorage = createMockStorage({
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
				configureCli: vi.fn(),
			});

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Mock makeCoderSdk to return a client that returns a successful user
			const mockUser = { username: "testuser", roles: [] };
			const mockSdkClient = createMockApi({
				getAuthenticatedUser: vi.fn().mockResolvedValue(mockUser),
			});
			const { makeCoderSdk, needToken } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue(mockSdkClient);
			vi.mocked(needToken).mockReturnValue(true); // Mock to use token auth

			// Mock toSafeHost
			const { toSafeHost } = await import("./util");
			vi.mocked(toSafeHost).mockReturnValue("test.coder.com");

			await commands.login("https://test.coder.com", "test-token");

			// Verify auth flow
			expect(mockRestClient.setHost).toHaveBeenCalledWith(
				"https://test.coder.com",
			);
			expect(mockRestClient.setSessionToken).toHaveBeenCalledWith("test-token");
			expect(mockStorage.setUrl).toHaveBeenCalledWith("https://test.coder.com");
			expect(mockStorage.setSessionToken).toHaveBeenCalledWith("test-token");
			expect(mockStorage.configureCli).toHaveBeenCalledWith(
				"test.coder.com",
				"https://test.coder.com",
				"test-token",
			);

			// Verify context was set
			expect(executeCommandMock).toHaveBeenCalledWith(
				"setContext",
				"coder.authenticated",
				true,
			);
			expect(executeCommandMock).toHaveBeenCalledWith(
				"coder.refreshWorkspaces",
			);
		});
	});

	describe("openAppStatus", () => {
		it("should open app URL when URL is provided", async () => {
			const openExternalMock = vi.fn().mockResolvedValue(true);
			vi.mocked(vscode.env.openExternal).mockImplementation(openExternalMock);

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage({
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
			});

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const mockApp = {
				name: "Test App",
				url: "https://app.test.coder.com",
				workspace_name: "test-workspace",
			};

			await commands.openAppStatus(mockApp);

			expect(openExternalMock).toHaveBeenCalledWith(
				expect.objectContaining({
					toString: expect.any(Function),
				}),
			);
		});

		it("should show app info when no url or command", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage({
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
			});

			const { uiProvider, getShownMessages } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const mockApp = {
				name: "Test App",
				agent_name: "main",
				workspace_name: "test-workspace",
			};

			await commands.openAppStatus(mockApp);

			const shownMessages = getShownMessages();
			expect(shownMessages).toHaveLength(1);
			expect(shownMessages[0]).toMatchObject({
				type: "info",
				message: "Test App",
				options: {
					detail: "Agent: main",
				},
			});
		});

		it("should run command in terminal when command is provided", async () => {
			const mockTerminal = {
				sendText: vi.fn(),
				show: vi.fn(),
			};
			vi.mocked(vscode.window.createTerminal).mockReturnValue(
				mockTerminal as never,
			);

			// Mock withProgress to immediately execute the task
			vi.mocked(vscode.window.withProgress).mockImplementation(
				async (options, task) => {
					return task({} as never, {} as never);
				},
			);

			// Mock toSafeHost
			const { toSafeHost } = await import("./util");
			vi.mocked(toSafeHost).mockReturnValue("test.coder.com");

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const mockApp = {
				name: "Test App",
				command: "npm start",
				workspace_name: "test-workspace",
			};

			// Use fake timers to skip the setTimeout
			vi.useFakeTimers();
			const promise = commands.openAppStatus(mockApp);
			// Run all timers and micro-tasks
			await vi.runAllTimersAsync();
			await promise;
			vi.useRealTimers();

			expect(vscode.window.createTerminal).toHaveBeenCalledWith("Test App");
			expect(mockTerminal.sendText).toHaveBeenCalledWith(
				expect.stringContaining("coder"),
			);
			expect(mockTerminal.sendText).toHaveBeenCalledWith("npm start");
			expect(mockTerminal.show).toHaveBeenCalledWith(false);
		});
	});

	describe("open", () => {
		it("should throw error when no deployment URL is provided", async () => {
			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "" },
				}),
			});
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			await expect(commands.open()).rejects.toThrow("You are not logged in");
		});

		it("should open workspace when parameters are provided", async () => {
			const executeCommandMock = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandMock,
			);

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "https://test.coder.com" },
				}),
			});
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Mock toRemoteAuthority
			const { toRemoteAuthority } = await import("./util");
			vi.mocked(toRemoteAuthority).mockReturnValue(
				"ssh-remote+coder-vscode.test-url--testuser--my-workspace",
			);

			// Test with parameters: workspaceOwner, workspaceName, reserved, folderPath
			await commands.open("testuser", "my-workspace", undefined, "/home/coder");

			// Should execute vscode.openFolder command (newWindow is false since no workspaceFolders)
			expect(executeCommandMock).toHaveBeenCalledWith(
				"vscode.openFolder",
				expect.objectContaining({
					scheme: "vscode-remote",
					path: "/home/coder",
				}),
				false,
			);
		});
	});

	describe("openDevContainer", () => {
		it("should handle dev container opening", async () => {
			const executeCommandMock = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandMock,
			);

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "https://test.coder.com" },
				}),
			});
			const mockStorage = createMockStorageWithAuth();

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Mock toRemoteAuthority
			const { toRemoteAuthority } = await import("./util");
			vi.mocked(toRemoteAuthority).mockReturnValue(
				"ssh-remote+coder-vscode.test-url--testuser--my-workspace",
			);

			// Test with parameters: workspaceOwner, workspaceName, reserved, devContainerName, devContainerFolder
			await commands.openDevContainer(
				"testuser",
				"my-workspace",
				"",
				"test-container",
				"/workspace",
			);

			// Should execute openFolder command with dev container authority (newWindow is false since no workspaceFolders)
			expect(executeCommandMock).toHaveBeenCalledWith(
				"vscode.openFolder",
				expect.objectContaining({
					scheme: "vscode-remote",
					path: "/workspace",
				}),
				false,
			);
		});

		it("should throw error when no coder url found for command", async () => {
			vi.mocked(vscode.window.withProgress).mockImplementation(
				async (options, task) => {
					return task({} as never, {} as never);
				},
			);

			const mockVscodeProposed = createMockVSCode();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage({
				getUrl: vi.fn().mockReturnValue(undefined), // No URL
			});

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			const mockApp = {
				name: "Test App",
				command: "npm start",
				workspace_name: "test-workspace",
			};

			await expect(commands.openAppStatus(mockApp)).rejects.toThrow(
				"No coder url found for sidebar",
			);
		});
	});

	describe("Logger integration", () => {
		it("should log autologin failure messages through Logger", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Mock makeCoderSdk to return a client that fails auth
			const { makeCoderSdk } = await import("./api");
			const mockSdkClient = {
				getAuthenticatedUser: vi
					.fn()
					.mockRejectedValue(new Error("Authentication failed")),
			};
			vi.mocked(makeCoderSdk).mockResolvedValue(mockSdkClient as never);

			// Mock needToken to return false so we go into the non-token auth path
			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

			// Mock getErrorMessage from coder/site
			const { getErrorMessage } = await import("coder/site/src/api/errors");
			vi.mocked(getErrorMessage).mockReturnValue("Authentication failed");

			// Mock showErrorMessage for vscodeProposed
			const mockVscodeProposed = createMockVSCode();

			const mockRestClient = createMockApi({
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			});

			// Create mock Storage that uses Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.info(msg);
				}),
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
				configureCli: vi.fn(),
			});

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Mock toSafeHost
			const { toSafeHost } = await import("./util");
			vi.mocked(toSafeHost).mockReturnValue("test.coder.com");

			// Call login with isAutologin = true (as string in args)
			await commands.login("https://test.coder.com", "test-token", "", "true");

			// Verify error was logged for autologin
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Failed to log in to Coder server: Authentication failed",
			);

			const logs = logger.getLogs();
			expect(logs.length).toBe(1);
			expect(logs[0].message).toBe(
				"Failed to log in to Coder server: Authentication failed",
			);
			expect(logs[0].level).toBe("INFO");

			// Verify showErrorMessage was NOT called (since it's autologin)
			expect(mockVscodeProposed.window.showErrorMessage).not.toHaveBeenCalled();
		});

		it("should work with Storage instance that has Logger set", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Mock makeCoderSdk to return a client that fails auth
			const { makeCoderSdk } = await import("./api");
			const mockSdkClient = {
				getAuthenticatedUser: vi
					.fn()
					.mockRejectedValue(new Error("Network error")),
			};
			vi.mocked(makeCoderSdk).mockResolvedValue(mockSdkClient as never);

			// Mock needToken to return false
			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

			// Mock getErrorMessage from coder/site
			const { getErrorMessage } = await import("coder/site/src/api/errors");
			vi.mocked(getErrorMessage).mockReturnValue("Network error");

			const mockVscodeProposed = createMockVSCode();

			const mockRestClient = createMockApi({
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			});

			// Simulate Storage with Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.error(msg);
				}),
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
				configureCli: vi.fn(),
			});

			const { uiProvider } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Mock toSafeHost
			const { toSafeHost } = await import("./util");
			vi.mocked(toSafeHost).mockReturnValue("example.coder.com");

			// Call login with isAutologin = true (as string in args)
			await commands.login(
				"https://example.coder.com",
				"bad-token",
				"",
				"true",
			);

			// Verify error was logged through Logger
			const logs = logger.getLogs();
			expect(logs.length).toBeGreaterThan(0);
			const hasExpectedLog = logs.some((log) =>
				log.message.includes("Failed to log in to Coder server: Network error"),
			);
			expect(hasExpectedLog).toBe(true);
		});

		it("should show error dialog when not autologin", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Mock makeCoderSdk to return a client that fails auth
			const { makeCoderSdk } = await import("./api");
			const mockSdkClient = {
				getAuthenticatedUser: vi
					.fn()
					.mockRejectedValue(new Error("Invalid token")),
			};
			vi.mocked(makeCoderSdk).mockResolvedValue(mockSdkClient as never);

			// Mock needToken to return false
			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

			// Mock getErrorMessage from coder/site
			const { getErrorMessage } = await import("coder/site/src/api/errors");
			vi.mocked(getErrorMessage).mockReturnValue("Invalid token");

			// Mock showErrorMessage for vscodeProposed
			const mockVscodeProposed = createMockVSCode();

			const mockRestClient = createMockApi({
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			});

			// Create mock Storage that uses Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.info(msg);
				}),
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
				configureCli: vi.fn(),
			});

			const { uiProvider, getShownMessages } = createTestUIProvider();
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
				uiProvider,
			);

			// Mock toSafeHost
			const { toSafeHost } = await import("./util");
			vi.mocked(toSafeHost).mockReturnValue("test.coder.com");

			// Call login with isAutologin = false (default)
			await commands.login("https://test.coder.com", "test-token");

			// Verify error dialog was shown (not logged)
			const shownMessages = getShownMessages();
			expect(shownMessages).toHaveLength(1);
			expect(shownMessages[0]).toMatchObject({
				type: "error",
				message: "Failed to log in to Coder server",
				options: {
					detail: "Invalid token",
					modal: true,
					useCustom: true,
				},
			});

			// Verify writeToCoderOutputChannel was NOT called
			expect(mockStorage.writeToCoderOutputChannel).not.toHaveBeenCalled();

			// Verify no logs were written
			const logs = logger.getLogs();
			expect(logs.length).toBe(0);
		});
	});
});
