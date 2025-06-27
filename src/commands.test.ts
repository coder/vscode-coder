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
} from "./test-helpers";
import type { UIProvider } from "./uiProvider";
import { OpenableTreeItem } from "./workspacesProvider";

// Mock dependencies
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./error");
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
	vi.mock("vscode", async () => {
		const helpers = await import("./test-helpers");
		return helpers.createMockVSCode();
	});
});

// Helper to create Commands instance with common setup
const createTestCommands = (
	overrides: {
		restClient?: Parameters<typeof createMockApi>[0];
		storage?: Parameters<typeof createMockStorage>[0];
		vscodeProposed?: typeof vscode;
		uiProvider?: UIProvider;
	} = {},
) => {
	const mockVscodeProposed = overrides.vscodeProposed || createMockVSCode();
	const mockRestClient = createMockApi(overrides.restClient);
	const mockStorage = overrides.storage
		? createMockStorage(overrides.storage)
		: createMockStorageWithAuth();
	const uiProvider = overrides.uiProvider || createTestUIProvider().uiProvider;

	return {
		commands: new Commands(
			mockVscodeProposed as typeof vscode,
			mockRestClient,
			mockStorage,
			uiProvider,
		),
		mockVscodeProposed,
		mockRestClient,
		mockStorage,
		uiProvider,
	};
};

describe("commands", () => {
	it.skip("should create Commands instance", () => {
		const { commands } = createTestCommands({ storage: {} });

		expect(commands).toBeInstanceOf(Commands);
		expect(commands.workspace).toBeUndefined();
		expect(commands.workspaceLogPath).toBeUndefined();
		expect(commands.workspaceRestClient).toBeUndefined();
	});

	describe("maybeAskAgent", () => {
		it.each([
			["no matching agents", [], undefined, "Workspace has no matching agents"],
			[
				"single agent",
				[createMockAgent({ id: "agent-1", name: "main", status: "connected" })],
				undefined,
				null,
			],
			[
				"filtered agent",
				[
					createMockAgent({ id: "agent-1", name: "main", status: "connected" }),
					createMockAgent({ id: "agent-2", name: "gpu", status: "connected" }),
				],
				"gpu",
				null,
			],
		])("should handle %s", async (_, agents, filter, expectedError) => {
			const { commands } = createTestCommands();

			// Mock extractAgents
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue(agents);

			const mockWorkspace = createMockWorkspace({ id: "test-workspace" });

			if (expectedError) {
				await expect(
					commands.maybeAskAgent(mockWorkspace, filter),
				).rejects.toThrow(expectedError);
			} else {
				const result = await commands.maybeAskAgent(mockWorkspace, filter);
				if (filter === "gpu") {
					expect(result).toBe(agents.find((a) => a.name === "gpu"));
				} else {
					expect(result).toBe(agents[0]);
				}
			}
		});
	});

	describe("viewLogs", () => {
		it("should show info message when no log path is set", async () => {
			const { uiProvider, getShownMessages } = createTestUIProvider();
			const { commands } = createTestCommands({ uiProvider });

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

			const { commands } = createTestCommands();

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
			vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
				undefined,
			);
			vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

			const { commands, mockStorage, mockRestClient } = createTestCommands();

			await commands.logout();

			expect(mockStorage.setUrl).toHaveBeenCalledWith(undefined);
			expect(mockStorage.setSessionToken).toHaveBeenCalledWith(undefined);
			expect(mockRestClient.setHost).toHaveBeenCalledWith("");
			expect(mockRestClient.setSessionToken).toHaveBeenCalledWith("");
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"setContext",
				"coder.authenticated",
				false,
			);
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.refreshWorkspaces",
			);
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				"You've been logged out of Coder!",
				"Login",
			);
		});
	});

	describe.each([
		["navigateToWorkspace", "navigateToWorkspace", ""],
		["navigateToWorkspaceSettings", "navigateToWorkspaceSettings", "/settings"],
	])("%s", (_, methodName, urlSuffix) => {
		it("should open workspace URL when workspace is provided", async () => {
			vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

			const { commands } = createTestCommands();

			const mockWorkspace = {
				workspaceOwner: "testuser",
				workspaceName: "my-workspace",
			} as OpenableTreeItem;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (commands as any)[methodName](mockWorkspace);

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"vscode.open",
				`https://test.coder.com/@testuser/my-workspace${urlSuffix}`,
			);
		});

		it("should show info message when no workspace is provided and not connected", async () => {
			const { uiProvider, getShownMessages } = createTestUIProvider();
			const { commands } = createTestCommands({ uiProvider });

			// Ensure workspace and workspaceRestClient are undefined
			commands.workspace = undefined;
			commands.workspaceRestClient = undefined;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (commands as any)[methodName](
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

	describe("createWorkspace", () => {
		it("should open templates URL", async () => {
			vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

			const { commands } = createTestCommands();

			await commands.createWorkspace();

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"vscode.open",
				"https://test.coder.com/templates",
			);
		});
	});

	describe("maybeAskUrl", () => {
		it.each([
			[
				"should normalize URL with https prefix when missing",
				"example.coder.com",
				"https://example.coder.com",
			],
			[
				"should remove trailing slashes",
				"https://example.coder.com///",
				"https://example.coder.com",
			],
		])("%s", async (_, input, expected) => {
			const { commands } = createTestCommands();

			const result = await commands.maybeAskUrl(input);

			expect(result).toBe(expected);
		});
	});

	describe("updateWorkspace", () => {
		it("should do nothing when no workspace is active", async () => {
			const { commands, mockVscodeProposed } = createTestCommands();

			// Ensure workspace and workspaceRestClient are undefined
			commands.workspace = undefined;
			commands.workspaceRestClient = undefined;

			await commands.updateWorkspace();

			// Should not show any message when no workspace
			expect(
				mockVscodeProposed.window?.showInformationMessage,
			).not.toHaveBeenCalled();
		});

		it("should prompt for confirmation and update workspace when user confirms", async () => {
			const updateWorkspaceVersionMock = vi.fn().mockResolvedValue(undefined);
			const mockWorkspaceRestClient = createMockApi({
				updateWorkspaceVersion: updateWorkspaceVersionMock,
			});

			const { uiProvider, addMessageResponse, getShownMessages } =
				createTestUIProvider();
			// Program the UI provider to return "Update" when prompted
			addMessageResponse("Update");

			const { commands } = createTestCommands({ uiProvider });

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
			const { commands } = createTestCommands({
				restClient: {
					getAxiosInstance: vi
						.fn()
						.mockReturnValue({ defaults: { baseURL: "" } }),
				},
			});

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
			const { commands } = createTestCommands();
			const maybeAskUrlSpy = vi
				.spyOn(commands, "maybeAskUrl")
				.mockResolvedValue(undefined);

			await commands.login();

			expect(maybeAskUrlSpy).toHaveBeenCalledWith(undefined);
		});
	});

	describe("openAppStatus", () => {
		it("should open app URL when URL is provided", async () => {
			vi.mocked(vscode.env.openExternal).mockResolvedValue(true);

			const { commands } = createTestCommands({
				storage: { getUrl: vi.fn().mockReturnValue("https://test.coder.com") },
			});

			await commands.openAppStatus({
				name: "Test App",
				url: "https://app.test.coder.com",
				workspace_name: "test-workspace",
			});

			expect(vscode.env.openExternal).toHaveBeenCalledWith(
				expect.objectContaining({ toString: expect.any(Function) }),
			);
		});

		it("should show app info when no url or command", async () => {
			const { uiProvider, getShownMessages } = createTestUIProvider();
			const { commands } = createTestCommands({
				storage: { getUrl: vi.fn().mockReturnValue("https://test.coder.com") },
				uiProvider,
			});

			await commands.openAppStatus({
				name: "Test App",
				agent_name: "main",
				workspace_name: "test-workspace",
			});

			const shownMessages = getShownMessages();
			expect(shownMessages).toHaveLength(1);
			expect(shownMessages[0]).toMatchObject({
				type: "info",
				message: "Test App",
				options: { detail: "Agent: main" },
			});
		});

		it("should run command in terminal when command is provided", async () => {
			const mockTerminal = { sendText: vi.fn(), show: vi.fn() };
			vi.mocked(vscode.window.createTerminal).mockReturnValue(
				mockTerminal as never,
			);
			vi.mocked(vscode.window.withProgress).mockImplementation(
				async (_, task) => task({} as never, {} as never),
			);

			const { toSafeHost } = await import("./util");
			vi.mocked(toSafeHost).mockReturnValue("test.coder.com");

			const { commands } = createTestCommands();

			// Use fake timers to skip the setTimeout
			vi.useFakeTimers();
			const promise = commands.openAppStatus({
				name: "Test App",
				command: "npm start",
				workspace_name: "test-workspace",
			});
			await vi.runAllTimersAsync();
			await promise;
			vi.useRealTimers();

			expect(vscode.window.createTerminal).toHaveBeenCalledWith("Test App");
			expect(mockTerminal.sendText).toHaveBeenCalledTimes(2);
			expect(mockTerminal.sendText).toHaveBeenCalledWith(
				expect.stringContaining("coder"),
			);
			expect(mockTerminal.sendText).toHaveBeenCalledWith("npm start");
			expect(mockTerminal.show).toHaveBeenCalledWith(false);
		});
	});

	describe("open", () => {
		it("should throw error when no deployment URL is provided", async () => {
			const { commands } = createTestCommands({
				restClient: {
					getAxiosInstance: vi
						.fn()
						.mockReturnValue({ defaults: { baseURL: "" } }),
				},
			});

			await expect(commands.open()).rejects.toThrow("You are not logged in");
		});

		it("should open workspace when parameters are provided", async () => {
			vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

			const { commands } = createTestCommands({
				restClient: {
					getAxiosInstance: vi.fn().mockReturnValue({
						defaults: { baseURL: "https://test.coder.com" },
					}),
				},
			});

			const { toRemoteAuthority } = await import("./util");
			vi.mocked(toRemoteAuthority).mockReturnValue(
				"ssh-remote+coder-vscode.test-url--testuser--my-workspace",
			);

			await commands.open("testuser", "my-workspace", undefined, "/home/coder");

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
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
			vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

			const { commands } = createTestCommands({
				restClient: {
					getAxiosInstance: vi.fn().mockReturnValue({
						defaults: { baseURL: "https://test.coder.com" },
					}),
				},
			});

			const { toRemoteAuthority } = await import("./util");
			vi.mocked(toRemoteAuthority).mockReturnValue(
				"ssh-remote+coder-vscode.test-url--testuser--my-workspace",
			);

			await commands.openDevContainer(
				"testuser",
				"my-workspace",
				"",
				"test-container",
				"/workspace",
			);

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
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
				async (_, task) => task({} as never, {} as never),
			);

			const { commands } = createTestCommands({
				storage: { getUrl: vi.fn().mockReturnValue(undefined) },
			});

			await expect(
				commands.openAppStatus({
					name: "Test App",
					command: "npm start",
					workspace_name: "test-workspace",
				}),
			).rejects.toThrow("No coder url found for sidebar");
		});
	});

	describe("Logger integration", () => {
		it("should log autologin failure messages through Logger", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Mock API failure
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue({
				getAuthenticatedUser: vi
					.fn()
					.mockRejectedValue(new Error("Authentication failed")),
			} as never);

			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

			const { getErrorMessage } = await import("coder/site/src/api/errors");
			vi.mocked(getErrorMessage).mockReturnValue("Authentication failed");

			const { toSafeHost } = await import("./util");
			vi.mocked(toSafeHost).mockReturnValue("test.coder.com");

			// Create commands with logger integration
			const { commands, mockStorage, mockVscodeProposed } = createTestCommands({
				storage: {
					writeToCoderOutputChannel: vi.fn((msg: string) => logger.info(msg)),
					setUrl: vi.fn(),
					setSessionToken: vi.fn(),
					configureCli: vi.fn(),
				},
			});

			await commands.login("https://test.coder.com", "test-token", "", "true");

			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Failed to log in to Coder server: Authentication failed",
			);

			const logs = logger.getLogs();
			expect(logs).toHaveLength(1);
			expect(logs[0]).toMatchObject({
				message: "Failed to log in to Coder server: Authentication failed",
				level: "INFO",
			});
			expect(mockVscodeProposed.window.showErrorMessage).not.toHaveBeenCalled();
		});

		it("should work with Storage instance that has Logger set", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Mock API failure
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue({
				getAuthenticatedUser: vi
					.fn()
					.mockRejectedValue(new Error("Network error")),
			} as never);

			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

			const { getErrorMessage } = await import("coder/site/src/api/errors");
			vi.mocked(getErrorMessage).mockReturnValue("Network error");

			const { toSafeHost } = await import("./util");
			vi.mocked(toSafeHost).mockReturnValue("example.coder.com");

			const { commands } = createTestCommands({
				storage: {
					writeToCoderOutputChannel: vi.fn((msg: string) => logger.error(msg)),
					setUrl: vi.fn(),
					setSessionToken: vi.fn(),
					configureCli: vi.fn(),
				},
			});

			await commands.login(
				"https://example.coder.com",
				"bad-token",
				"",
				"true",
			);

			const logs = logger.getLogs();
			expect(
				logs.some((log) =>
					log.message.includes(
						"Failed to log in to Coder server: Network error",
					),
				),
			).toBe(true);
		});

		it("should show error dialog when not autologin", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Mock API failure
			const { makeCoderSdk } = await import("./api");
			vi.mocked(makeCoderSdk).mockResolvedValue({
				getAuthenticatedUser: vi
					.fn()
					.mockRejectedValue(new Error("Invalid token")),
			} as never);

			const { needToken } = await import("./api");
			vi.mocked(needToken).mockReturnValue(false);

			const { getErrorMessage } = await import("coder/site/src/api/errors");
			vi.mocked(getErrorMessage).mockReturnValue("Invalid token");

			const { toSafeHost } = await import("./util");
			vi.mocked(toSafeHost).mockReturnValue("test.coder.com");

			const { uiProvider, getShownMessages } = createTestUIProvider();
			const { commands, mockStorage } = createTestCommands({
				uiProvider,
				storage: {
					writeToCoderOutputChannel: vi.fn((msg: string) => logger.info(msg)),
					setUrl: vi.fn(),
					setSessionToken: vi.fn(),
					configureCli: vi.fn(),
				},
			});

			await commands.login("https://test.coder.com", "test-token");

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

			expect(mockStorage.writeToCoderOutputChannel).not.toHaveBeenCalled();
			expect(logger.getLogs()).toHaveLength(0);
		});
	});
});
