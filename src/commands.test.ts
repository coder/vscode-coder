import { Api } from "coder/site/src/api/api";
import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated";
import { describe, it, expect, vi, beforeAll } from "vitest";
import * as vscode from "vscode";
import { Commands } from "./commands";
import { Storage } from "./storage";
import { createMockOutputChannelWithLogger } from "./test-helpers";
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
		return {
			window: {
				showInformationMessage: vi.fn().mockResolvedValue(undefined),
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
		};
	});
});

describe("commands", () => {
	it("should create Commands instance", () => {
		const mockVscodeProposed = {} as typeof vscode;
		const mockRestClient = {} as Api;
		const mockStorage = {} as Storage;

		const commands = new Commands(
			mockVscodeProposed,
			mockRestClient,
			mockStorage,
		);

		expect(commands).toBeInstanceOf(Commands);
		expect(commands.workspace).toBeUndefined();
		expect(commands.workspaceLogPath).toBeUndefined();
		expect(commands.workspaceRestClient).toBeUndefined();
	});

	describe("maybeAskAgent", () => {
		it("should throw error when no matching agents", async () => {
			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			// Mock extractAgents to return empty array
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([]);

			const mockWorkspace = { id: "test-workspace" } as Workspace;

			await expect(commands.maybeAskAgent(mockWorkspace)).rejects.toThrow(
				"Workspace has no matching agents",
			);
		});

		it("should return single agent when only one exists", async () => {
			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			const mockAgent = {
				id: "agent-1",
				name: "main",
				status: "connected",
			} as WorkspaceAgent;

			// Mock extractAgents to return single agent
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([mockAgent]);

			const mockWorkspace = { id: "test-workspace" } as Workspace;

			const result = await commands.maybeAskAgent(mockWorkspace);
			expect(result).toBe(mockAgent);
		});

		it("should filter agents by name when filter provided", async () => {
			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			const mainAgent = {
				id: "agent-1",
				name: "main",
				status: "connected",
			} as WorkspaceAgent;

			const gpuAgent = {
				id: "agent-2",
				name: "gpu",
				status: "connected",
			} as WorkspaceAgent;

			// Mock extractAgents to return multiple agents
			const { extractAgents } = await import("./api-helper");
			vi.mocked(extractAgents).mockReturnValue([mainAgent, gpuAgent]);

			const mockWorkspace = { id: "test-workspace" } as Workspace;

			// Should return gpu agent when filtered by name
			const result = await commands.maybeAskAgent(mockWorkspace, "gpu");
			expect(result).toBe(gpuAgent);
		});
	});

	describe("viewLogs", () => {
		it("should show info message when no log path is set", async () => {
			// Mock vscode window methods
			const showInformationMessageMock = vi.fn();
			vi.mocked(vscode.window.showInformationMessage).mockImplementation(
				showInformationMessageMock,
			);

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			// Ensure workspaceLogPath is undefined
			commands.workspaceLogPath = undefined;

			await commands.viewLogs();

			expect(showInformationMessageMock).toHaveBeenCalledWith(
				"No logs available. Make sure to set coder.proxyLogDirectory to get logs.",
				"<unset>",
			);
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

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;
			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			} as unknown as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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
			const showInformationMessageMock = vi.fn();
			vi.mocked(vscode.window.showInformationMessage).mockImplementation(
				showInformationMessageMock,
			);

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			// Ensure workspace and workspaceRestClient are undefined
			commands.workspace = undefined;
			commands.workspaceRestClient = undefined;

			await commands.navigateToWorkspace(
				undefined as unknown as OpenableTreeItem,
			);

			expect(showInformationMessageMock).toHaveBeenCalledWith(
				"No workspace found.",
			);
		});
	});

	describe("navigateToWorkspaceSettings", () => {
		it("should open workspace settings URL when workspace is provided", async () => {
			const executeCommandMock = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandMock,
			);

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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

			const mockVscodeProposed = {} as typeof vscode;
			const mockAxiosInstance = {
				defaults: {
					baseURL: "https://connected.coder.com",
				},
			};
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue(mockAxiosInstance),
			} as unknown as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			// Set up connected workspace
			commands.workspace = {
				owner_name: "connecteduser",
				name: "connected-workspace",
			} as Workspace;
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

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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
			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			// Mock askURL to return undefined (user aborted)
			const askURLSpy = vi
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.spyOn(commands as any, "askURL")
				.mockResolvedValue(undefined);

			const result = await commands.maybeAskUrl(null);

			expect(result).toBeUndefined();
			expect(askURLSpy).toHaveBeenCalledWith(undefined);
		});

		it("should normalize URL with https prefix when missing", async () => {
			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			const result = await commands.maybeAskUrl("example.coder.com");

			expect(result).toBe("https://example.coder.com");
		});

		it("should remove trailing slashes", async () => {
			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			const result = await commands.maybeAskUrl("https://example.coder.com///");

			expect(result).toBe("https://example.coder.com");
		});
	});

	describe("updateWorkspace", () => {
		it("should do nothing when no workspace is active", async () => {
			const mockVscodeProposed = {
				window: {
					showInformationMessage: vi.fn(),
				},
			} as unknown as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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
			const showInformationMessageMock = vi.fn().mockResolvedValue("Update");
			const updateWorkspaceVersionMock = vi.fn().mockResolvedValue(undefined);

			const mockVscodeProposed = {
				window: {
					showInformationMessage: showInformationMessageMock,
				},
			} as unknown as typeof vscode;

			const mockWorkspaceRestClient = {
				updateWorkspaceVersion: updateWorkspaceVersionMock,
			} as unknown as Api;

			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			// Set up active workspace
			const mockWorkspace = {
				owner_name: "testuser",
				name: "my-workspace",
			} as Workspace;
			commands.workspace = mockWorkspace;
			commands.workspaceRestClient = mockWorkspaceRestClient;

			await commands.updateWorkspace();

			// Verify confirmation dialog was shown
			expect(showInformationMessageMock).toHaveBeenCalledWith(
				"Update Workspace",
				{
					useCustom: true,
					modal: true,
					detail: "Update testuser/my-workspace to the latest version?",
				},
				"Update",
			);

			// Verify workspace was updated
			expect(updateWorkspaceVersionMock).toHaveBeenCalledWith(mockWorkspace);
		});
	});

	describe("openFromSidebar", () => {
		it("should throw error when not logged in", async () => {
			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "" }, // Empty baseURL indicates not logged in
				}),
			} as unknown as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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
			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			// Mock maybeAskUrl to return undefined (user cancelled)
			const maybeAskUrlSpy = vi
				.spyOn(commands, "maybeAskUrl")
				.mockResolvedValue(undefined);

			await commands.login();

			expect(maybeAskUrlSpy).toHaveBeenCalledWith(undefined);
			// Should not proceed to ask for token
		});

		it("should abort when user cancels token request", async () => {
			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			// Mock maybeAskUrl to return a URL
			vi.spyOn(commands, "maybeAskUrl").mockResolvedValue(
				"https://test.coder.com",
			);

			// Mock maybeAskToken to return undefined (user cancelled)
			const maybeAskTokenSpy = vi
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.spyOn(commands as any, "maybeAskToken")
				.mockResolvedValue(undefined);

			await commands.login();

			expect(maybeAskTokenSpy).toHaveBeenCalledWith(
				"https://test.coder.com",
				undefined,
				false,
			);
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

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			} as unknown as Api;
			const mockStorage = {
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
				configureCli: vi.fn(),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			// Mock successful auth
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			vi.spyOn(commands as any, "maybeAskToken").mockResolvedValue({
				token: "test-token",
				user: { username: "testuser", roles: [] },
			});

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

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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
			const showInformationMessageMock = vi.fn();
			vi.mocked(vscode.window.showInformationMessage).mockImplementation(
				showInformationMessageMock,
			);

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			const mockApp = {
				name: "Test App",
				agent_name: "main",
				workspace_name: "test-workspace",
			};

			await commands.openAppStatus(mockApp);

			expect(showInformationMessageMock).toHaveBeenCalledWith("Test App", {
				detail: "Agent: main",
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

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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
			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "" },
				}),
			} as unknown as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			await expect(commands.open()).rejects.toThrow("You are not logged in");
		});

		it("should open workspace when parameters are provided", async () => {
			const executeCommandMock = vi.fn();
			vi.mocked(vscode.commands.executeCommand).mockImplementation(
				executeCommandMock,
			);

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "https://test.coder.com" },
				}),
			} as unknown as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "https://test.coder.com" },
				}),
			} as unknown as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
				fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
				getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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

			const mockVscodeProposed = {} as typeof vscode;
			const mockRestClient = {} as Api;
			const mockStorage = {
				getUrl: vi.fn().mockReturnValue(undefined), // No URL
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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
			const mockVscodeProposed = {
				window: {
					showErrorMessage: vi.fn(),
				},
			} as unknown as typeof vscode;

			const mockRestClient = {
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			} as unknown as Api;

			// Create mock Storage that uses Logger
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.info(msg);
				}),
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
				configureCli: vi.fn(),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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

			const mockVscodeProposed = {
				window: {
					showErrorMessage: vi.fn(),
				},
			} as unknown as typeof vscode;

			const mockRestClient = {
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			} as unknown as Api;

			// Simulate Storage with Logger
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.error(msg);
				}),
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
				configureCli: vi.fn(),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
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
			const showErrorMessageMock = vi.fn();
			const mockVscodeProposed = {
				window: {
					showErrorMessage: showErrorMessageMock,
				},
			} as unknown as typeof vscode;

			const mockRestClient = {
				setHost: vi.fn(),
				setSessionToken: vi.fn(),
			} as unknown as Api;

			// Create mock Storage that uses Logger
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.info(msg);
				}),
				setUrl: vi.fn(),
				setSessionToken: vi.fn(),
				configureCli: vi.fn(),
			} as unknown as Storage;

			const commands = new Commands(
				mockVscodeProposed,
				mockRestClient,
				mockStorage,
			);

			// Mock toSafeHost
			const { toSafeHost } = await import("./util");
			vi.mocked(toSafeHost).mockReturnValue("test.coder.com");

			// Call login with isAutologin = false (default)
			await commands.login("https://test.coder.com", "test-token");

			// Verify error dialog was shown (not logged)
			expect(showErrorMessageMock).toHaveBeenCalledWith(
				"Failed to log in to Coder server",
				{
					detail: "Invalid token",
					modal: true,
					useCustom: true,
				},
			);

			// Verify writeToCoderOutputChannel was NOT called
			expect(mockStorage.writeToCoderOutputChannel).not.toHaveBeenCalled();

			// Verify no logs were written
			const logs = logger.getLogs();
			expect(logs.length).toBe(0);
		});
	});
});
