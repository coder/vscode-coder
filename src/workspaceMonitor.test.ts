import { Workspace } from "coder/site/src/api/typesGenerated";
import { describe, it, expect, vi, beforeAll } from "vitest";
import {
	createMockOutputChannelWithLogger,
	getPrivateProperty,
	createMockWorkspace,
	createMockApi,
	createMockStorage,
	createMockVSCode,
	createMockWorkspaceRunning,
	createMockWorkspaceStopped,
} from "./test-helpers";
import { WorkspaceMonitor } from "./workspaceMonitor";

// Mock dependencies
vi.mock("eventsource", () => ({
	EventSource: class MockEventSource {
		addEventListener = vi.fn();
		close = vi.fn();
	},
}));
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./storage");

beforeAll(() => {
	vi.mock("vscode", async () => {
		const { createMockVSCode, createMockStatusBarItem } = await import(
			"./test-helpers"
		);
		const mockVSCode = createMockVSCode();
		return {
			...mockVSCode,
			window: {
				...mockVSCode.window,
				createStatusBarItem: vi.fn(() => createMockStatusBarItem()),
			},
			StatusBarAlignment: {
				Left: 1,
				Right: 2,
			},
		};
	});
});

describe("workspaceMonitor", () => {
	it("should create WorkspaceMonitor instance", () => {
		const mockWorkspace = createMockWorkspace();
		const mockRestClient = createMockApi();
		const mockStorage = createMockStorage();
		const mockVscodeProposed = createMockVSCode();

		const monitor = new WorkspaceMonitor(
			mockWorkspace,
			mockRestClient,
			mockStorage,
			mockVscodeProposed,
		);

		expect(monitor).toBeInstanceOf(WorkspaceMonitor);
		expect(typeof monitor.dispose).toBe("function");
		expect(monitor.onChange).toBeDefined();
	});

	describe("dispose", () => {
		it("should dispose resources and close event source", () => {
			const mockWorkspace = createMockWorkspace({
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
			});

			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();
			const mockVscodeProposed = createMockVSCode();

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Spy on the private properties - we need to access them to verify cleanup
			const eventSource = getPrivateProperty(monitor, "eventSource") as {
				close: ReturnType<typeof vi.fn>;
			};
			const statusBarItem = getPrivateProperty(monitor, "statusBarItem") as {
				dispose: ReturnType<typeof vi.fn>;
			};
			const closeSpy = vi.spyOn(eventSource, "close");
			const disposeSpy = vi.spyOn(statusBarItem, "dispose");

			// Call dispose
			monitor.dispose();

			// Verify cleanup
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Unmonitoring test-owner/test-workspace...",
			);
			expect(disposeSpy).toHaveBeenCalled();
			expect(closeSpy).toHaveBeenCalled();

			// Verify disposed flag is set
			expect(getPrivateProperty(monitor, "disposed")).toBe(true);
		});

		it("should not dispose twice when called multiple times", () => {
			const mockWorkspace = createMockWorkspace({
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
			});

			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();
			const mockVscodeProposed = createMockVSCode();

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			const eventSource = getPrivateProperty(monitor, "eventSource") as {
				close: ReturnType<typeof vi.fn>;
			};
			const statusBarItem = getPrivateProperty(monitor, "statusBarItem") as {
				dispose: ReturnType<typeof vi.fn>;
			};
			const closeSpy = vi.spyOn(eventSource, "close");
			const disposeSpy = vi.spyOn(statusBarItem, "dispose");

			// Call dispose twice
			monitor.dispose();
			monitor.dispose();

			// Verify cleanup only happened once
			expect(closeSpy).toHaveBeenCalledTimes(1);
			expect(disposeSpy).toHaveBeenCalledTimes(1);
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledTimes(2); // Once for monitoring, once for unmonitoring
		});
	});

	describe("maybeNotifyAutostop", () => {
		it("should notify about impending autostop when workspace is running and deadline is soon", async () => {
			const mockWorkspace = createMockWorkspaceRunning({
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
				latest_build: {
					...createMockWorkspaceRunning().latest_build,
					deadline: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes from now
				},
			});

			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();
			const mockVscodeProposed = createMockVSCode();

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Mock the global vscode window method
			const vscode = await import("vscode");
			vi.mocked(vscode.window.showInformationMessage).mockClear();

			// Call the private maybeNotifyAutostop method
			const maybeNotifyAutostop = getPrivateProperty(
				monitor,
				"maybeNotifyAutostop",
			) as (workspace: Workspace) => void;
			maybeNotifyAutostop.call(monitor, mockWorkspace);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("is scheduled to shut down in"),
			);
		});
	});

	describe("isImpending", () => {
		it("should return true when target time is within notify window", () => {
			const mockWorkspace = createMockWorkspace();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();
			const mockVscodeProposed = createMockVSCode();

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Test with a target time 10 minutes from now and 30-minute notify window
			const targetTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			const notifyTime = 30 * 60 * 1000; // 30 minutes

			const isImpending = getPrivateProperty(monitor, "isImpending") as (
				targetTime: string,
				notifyTime: number,
			) => boolean;
			const result = isImpending.call(monitor, targetTime, notifyTime);

			expect(result).toBe(true);
		});

		it("should return false when target time is beyond notify window", () => {
			const mockWorkspace = createMockWorkspace();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();
			const mockVscodeProposed = createMockVSCode();

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Test with a target time 2 hours from now and 30-minute notify window
			const targetTime = new Date(
				Date.now() + 2 * 60 * 60 * 1000,
			).toISOString();
			const notifyTime = 30 * 60 * 1000; // 30 minutes

			const isImpending = getPrivateProperty(monitor, "isImpending") as (
				targetTime: string,
				notifyTime: number,
			) => boolean;
			const result = isImpending.call(monitor, targetTime, notifyTime);

			expect(result).toBe(false);
		});
	});

	describe("updateStatusBar", () => {
		it("should show status bar when workspace is outdated", () => {
			const mockWorkspace = createMockWorkspace({
				outdated: false,
			});
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();
			const mockVscodeProposed = createMockVSCode();

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			const statusBarItem = getPrivateProperty(monitor, "statusBarItem") as {
				show: ReturnType<typeof vi.fn>;
				hide: ReturnType<typeof vi.fn>;
			};
			const showSpy = vi.spyOn(statusBarItem, "show");
			const hideSpy = vi.spyOn(statusBarItem, "hide");

			// Test outdated workspace
			const outdatedWorkspace = createMockWorkspace({ outdated: true });
			const updateStatusBar = getPrivateProperty(
				monitor,
				"updateStatusBar",
			) as (workspace: Workspace) => void;
			updateStatusBar.call(monitor, outdatedWorkspace);
			expect(showSpy).toHaveBeenCalled();
			expect(hideSpy).not.toHaveBeenCalled();

			// Clear mocks
			showSpy.mockClear();
			hideSpy.mockClear();

			// Test up-to-date workspace
			const currentWorkspace = createMockWorkspace({ outdated: false });
			updateStatusBar.call(monitor, currentWorkspace);
			expect(hideSpy).toHaveBeenCalled();
			expect(showSpy).not.toHaveBeenCalled();
		});
	});

	describe("notifyError", () => {
		it("should write error to output channel", () => {
			const mockWorkspace = createMockWorkspace();
			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();
			const mockVscodeProposed = createMockVSCode();

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Mock errToStr
			vi.doMock("./api-helper", () => ({
				errToStr: vi.fn().mockReturnValue("Test error message"),
			}));

			// Call the private notifyError method
			const testError = new Error("Test error");
			const notifyError = getPrivateProperty(monitor, "notifyError") as (
				error: Error,
			) => void;
			notifyError.call(monitor, testError);

			// Verify error was written to output channel
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				expect.any(String),
			);

			vi.doUnmock("./api-helper");
		});
	});

	describe("maybeNotifyDeletion", () => {
		it("should notify about impending deletion when workspace has deleting_at and deadline is soon", async () => {
			const mockWorkspace = createMockWorkspace({
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
				deleting_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // 12 hours from now
			});

			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();
			const mockVscodeProposed = createMockVSCode();

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Mock the global vscode window method
			const vscode = await import("vscode");
			vi.mocked(vscode.window.showInformationMessage).mockClear();

			// Call the private maybeNotifyDeletion method
			const maybeNotifyDeletion = getPrivateProperty(
				monitor,
				"maybeNotifyDeletion",
			) as (workspace: Workspace) => void;
			maybeNotifyDeletion.call(monitor, mockWorkspace);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("is scheduled for deletion in"),
			);
		});
	});

	describe("maybeNotifyNotRunning", () => {
		it("should notify and offer reload when workspace is not running", async () => {
			const mockWorkspace = createMockWorkspaceStopped({
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
			});

			const mockRestClient = createMockApi();
			const mockStorage = createMockStorage();

			// Mock vscodeProposed with showInformationMessage
			const mockShowInformationMessage = vi
				.fn()
				.mockResolvedValue("Reload Window");
			const mockVscodeProposed = createMockVSCode();
			vi.mocked(
				mockVscodeProposed.window.showInformationMessage,
			).mockImplementation(mockShowInformationMessage);

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Mock the global vscode commands
			const vscode = await import("vscode");
			vi.mocked(vscode.commands.executeCommand).mockClear();

			// Call the private maybeNotifyNotRunning method
			const maybeNotifyNotRunning = getPrivateProperty(
				monitor,
				"maybeNotifyNotRunning",
			) as (workspace: Workspace) => Promise<void>;
			await maybeNotifyNotRunning.call(monitor, mockWorkspace);

			expect(mockShowInformationMessage).toHaveBeenCalledWith(
				"test-owner/test-workspace is no longer running!",
				{
					detail:
						'The workspace status is "stopped". Reload the window to reconnect.',
					modal: true,
					useCustom: true,
				},
				"Reload Window",
			);

			// Wait for the promise to resolve
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"workbench.action.reloadWindow",
			);
		});
	});

	describe("maybeNotifyOutdated", () => {
		it("should notify about outdated workspace and offer update", async () => {
			const mockWorkspace = createMockWorkspace({
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
				template_id: "template-123",
				outdated: true,
			});

			const mockTemplate = {
				active_version_id: "version-456",
			};

			const mockTemplateVersion = {
				message: "New version with improved performance",
			};

			const mockRestClient = createMockApi({
				getTemplate: vi.fn().mockResolvedValue(mockTemplate),
				getTemplateVersion: vi.fn().mockResolvedValue(mockTemplateVersion),
			});
			const mockStorage = createMockStorage();
			const mockVscodeProposed = createMockVSCode();

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Mock the global vscode window method
			const vscode = await import("vscode");
			vi.mocked(vscode.window.showInformationMessage).mockClear();
			vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
				"Update" as never,
			);
			vi.mocked(vscode.commands.executeCommand).mockClear();

			// Call the private maybeNotifyOutdated method
			const maybeNotifyOutdated = getPrivateProperty(
				monitor,
				"maybeNotifyOutdated",
			) as (workspace: Workspace) => Promise<void>;
			await maybeNotifyOutdated.call(monitor, mockWorkspace);

			// Wait for promises to resolve
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(mockRestClient.getTemplate).toHaveBeenCalledWith("template-123");
			expect(mockRestClient.getTemplateVersion).toHaveBeenCalledWith(
				"version-456",
			);
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				"A new version of your workspace is available: New version with improved performance",
				"Update",
			);
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.workspace.update",
				mockWorkspace,
				mockRestClient,
			);
		});
	});

	describe("Logger integration", () => {
		it("should log messages through Logger when Storage has Logger set", () => {
			const { logger } = createMockOutputChannelWithLogger();

			const mockWorkspace = createMockWorkspace({
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
			});

			const mockRestClient = createMockApi();

			// Create mock Storage that uses Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.info(msg);
				}),
			});

			const mockVscodeProposed = createMockVSCode();

			// Create WorkspaceMonitor which should log initialization
			new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Verify monitoring message was logged
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Monitoring test-owner/test-workspace...",
			);

			const logs = logger.getLogs();
			expect(logs.length).toBeGreaterThan(0);
			expect(logs[0].message).toBe("Monitoring test-owner/test-workspace...");
		});

		it("should handle dispose and log unmonitoring message", () => {
			const { logger } = createMockOutputChannelWithLogger();

			const mockWorkspace = createMockWorkspace({
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
			});

			const mockRestClient = createMockApi();

			// Create mock Storage that uses Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.info(msg);
				}),
			});

			const mockVscodeProposed = createMockVSCode();

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Clear logs from initialization
			logger.clear();
			vi.mocked(mockStorage.writeToCoderOutputChannel).mockClear();

			// Dispose the monitor
			monitor.dispose();

			// Verify unmonitoring message was logged
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Unmonitoring test-owner/test-workspace...",
			);

			const logs = logger.getLogs();
			expect(logs.length).toBe(1);
			expect(logs[0].message).toBe("Unmonitoring test-owner/test-workspace...");
		});
	});
});
