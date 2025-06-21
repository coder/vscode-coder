import { Api } from "coder/site/src/api/api";
import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated";
import { describe, it, expect, vi, beforeAll } from "vitest";
import * as vscode from "vscode";
import { Commands } from "./commands";
import { Storage } from "./storage";

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
	});
});
