import { Api } from "coder/site/src/api/api";
import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated";
import { describe, it, expect, vi, beforeAll } from "vitest";
import * as vscode from "vscode";
import { Commands } from "./commands";
import { Storage } from "./storage";
import { OpenableTreeItem } from "./workspacesProvider";

// Mock dependencies
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./error");
vi.mock("./storage");
vi.mock("./util");
vi.mock("./workspacesProvider");

beforeAll(() => {
	vi.mock("vscode", () => {
		return {
			window: {
				showInformationMessage: vi.fn(),
				createQuickPick: vi.fn(),
				showTextDocument: vi.fn(),
			},
			workspace: {
				openTextDocument: vi.fn(),
			},
			Uri: {
				file: vi.fn(),
			},
			commands: {
				executeCommand: vi.fn(),
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
			const mockStorage = {} as Storage;
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
			const mockStorage = {} as Storage;
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
			const mockStorage = {} as Storage;
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
			const mockStorage = {} as Storage;
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
			const mockStorage = {} as Storage;
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
			const mockStorage = {} as Storage;

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
			const mockStorage = {} as Storage;

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
			const mockStorage = {} as Storage;

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
			const mockStorage = {} as Storage;

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
			const mockStorage = {} as Storage;

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
			const mockStorage = {} as Storage;

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
			const mockStorage = {} as Storage;

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
			const mockStorage = {} as Storage;

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
});
