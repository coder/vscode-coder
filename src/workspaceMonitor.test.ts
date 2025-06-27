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
			StatusBarAlignment: { Left: 1, Right: 2 },
		};
	});
});

// Test helpers
const createTestMonitor = (workspaceOverrides = {}) => {
	const mockWorkspace = createMockWorkspace({
		owner_name: "test-owner",
		name: "test-workspace",
		id: "test-id",
		...workspaceOverrides,
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

	return {
		monitor,
		mockWorkspace,
		mockRestClient,
		mockStorage,
		mockVscodeProposed,
	};
};

const getPrivateProp = <T>(monitor: WorkspaceMonitor, prop: string): T =>
	getPrivateProperty(monitor, prop) as T;

describe("workspaceMonitor", () => {
	it("should create WorkspaceMonitor instance", () => {
		const { monitor } = createTestMonitor();
		expect(monitor).toBeInstanceOf(WorkspaceMonitor);
		expect(typeof monitor.dispose).toBe("function");
		expect(monitor.onChange).toBeDefined();
	});

	describe("dispose", () => {
		it.each([
			["first call", 1],
			["multiple calls", 2],
		])("should dispose resources correctly on %s", (_, callCount) => {
			const { monitor, mockStorage } = createTestMonitor();

			const eventSource = getPrivateProp<{ close: ReturnType<typeof vi.fn> }>(
				monitor,
				"eventSource",
			);
			const statusBarItem = getPrivateProp<{
				dispose: ReturnType<typeof vi.fn>;
			}>(monitor, "statusBarItem");
			const closeSpy = vi.spyOn(eventSource, "close");
			const disposeSpy = vi.spyOn(statusBarItem, "dispose");

			for (let i = 0; i < callCount; i++) {
				monitor.dispose();
			}

			expect(closeSpy).toHaveBeenCalledTimes(1);
			expect(disposeSpy).toHaveBeenCalledTimes(1);
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Unmonitoring test-owner/test-workspace...",
			);
			expect(getPrivateProp<boolean>(monitor, "disposed")).toBe(true);
		});
	});

	describe("notifications", () => {
		it.each([
			[
				"autostop",
				{
					latest_build: {
						...createMockWorkspaceRunning().latest_build,
						deadline: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
					},
				},
				"maybeNotifyAutostop",
				"is scheduled to shut down in",
			],
			[
				"deletion",
				{
					deleting_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
				},
				"maybeNotifyDeletion",
				"is scheduled for deletion in",
			],
		])(
			"should notify about %s",
			async (_, workspaceOverrides, methodName, expectedMessage) => {
				const { monitor } = createTestMonitor(workspaceOverrides);
				const vscode = await import("vscode");
				vi.mocked(vscode.window.showInformationMessage).mockClear();

				const method = getPrivateProp<(workspace: Workspace) => void>(
					monitor,
					methodName,
				);
				method.call(monitor, createMockWorkspace(workspaceOverrides));

				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
					expect.stringContaining(expectedMessage),
				);
			},
		);
	});

	describe("isImpending", () => {
		it.each([
			["within window", 10, 30, true],
			["beyond window", 120, 30, false],
		])(
			"should return %s when target is %d minutes away with %d minute window",
			(_, targetMinutes, windowMinutes, expected) => {
				const { monitor } = createTestMonitor();
				const targetTime = new Date(
					Date.now() + targetMinutes * 60 * 1000,
				).toISOString();
				const notifyTime = windowMinutes * 60 * 1000;

				const isImpending = getPrivateProp<
					(targetTime: string, notifyTime: number) => boolean
				>(monitor, "isImpending");
				expect(isImpending.call(monitor, targetTime, notifyTime)).toBe(
					expected,
				);
			},
		);
	});

	describe("statusBar", () => {
		it.each([
			["show", true],
			["hide", false],
		])(
			"should %s status bar when workspace outdated is %s",
			(action, outdated) => {
				const { monitor } = createTestMonitor();
				const statusBarItem = getPrivateProp<{
					show: ReturnType<typeof vi.fn>;
					hide: ReturnType<typeof vi.fn>;
				}>(monitor, "statusBarItem");

				// Clear any calls from initialization
				vi.mocked(statusBarItem.show).mockClear();
				vi.mocked(statusBarItem.hide).mockClear();

				const updateStatusBar = getPrivateProp<(workspace: Workspace) => void>(
					monitor,
					"updateStatusBar",
				);
				updateStatusBar.call(monitor, createMockWorkspace({ outdated }));

				if (outdated) {
					expect(statusBarItem.show).toHaveBeenCalled();
					expect(statusBarItem.hide).not.toHaveBeenCalled();
				} else {
					expect(statusBarItem.hide).toHaveBeenCalled();
					expect(statusBarItem.show).not.toHaveBeenCalled();
				}
			},
		);
	});

	it("should write errors to output channel", () => {
		const { monitor, mockStorage } = createTestMonitor();
		vi.doMock("./api-helper", () => ({
			errToStr: vi.fn().mockReturnValue("Test error message"),
		}));

		const notifyError = getPrivateProp<(error: Error) => void>(
			monitor,
			"notifyError",
		);
		notifyError.call(monitor, new Error("Test error"));

		expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
			expect.any(String),
		);
		vi.doUnmock("./api-helper");
	});

	it("should notify and reload when workspace is not running", async () => {
		const mockShowInformationMessage = vi
			.fn()
			.mockResolvedValue("Reload Window");
		const mockVscodeProposed = createMockVSCode();
		vi.mocked(
			mockVscodeProposed.window.showInformationMessage,
		).mockImplementation(mockShowInformationMessage);

		const mockWorkspace = createMockWorkspaceStopped({
			owner_name: "test-owner",
			name: "test-workspace",
		});
		const monitor = new WorkspaceMonitor(
			mockWorkspace,
			createMockApi(),
			createMockStorage(),
			mockVscodeProposed,
		);

		const vscode = await import("vscode");
		vi.mocked(vscode.commands.executeCommand).mockClear();

		const maybeNotifyNotRunning = getPrivateProp<
			(workspace: Workspace) => Promise<void>
		>(monitor, "maybeNotifyNotRunning");
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

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"workbench.action.reloadWindow",
		);
	});

	it("should notify about outdated workspace and offer update", async () => {
		const mockTemplate = { active_version_id: "version-456" };
		const mockTemplateVersion = {
			message: "New version with improved performance",
		};
		const mockRestClient = createMockApi({
			getTemplate: vi.fn().mockResolvedValue(mockTemplate),
			getTemplateVersion: vi.fn().mockResolvedValue(mockTemplateVersion),
		});

		const mockWorkspace = createMockWorkspace({
			template_id: "template-123",
			outdated: true,
			owner_name: "test-owner",
			name: "test-workspace",
		});
		const monitor = new WorkspaceMonitor(
			mockWorkspace,
			mockRestClient,
			createMockStorage(),
			createMockVSCode(),
		);

		const vscode = await import("vscode");
		vi.mocked(vscode.window.showInformationMessage)
			.mockClear()
			.mockResolvedValue("Update" as never);
		vi.mocked(vscode.commands.executeCommand).mockClear();

		const maybeNotifyOutdated = getPrivateProp<
			(workspace: Workspace) => Promise<void>
		>(monitor, "maybeNotifyOutdated");
		await maybeNotifyOutdated.call(monitor, mockWorkspace);

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

	describe("Logger integration", () => {
		it.each([
			["initialization", "Monitoring test-owner/test-workspace...", false],
			["disposal", "Unmonitoring test-owner/test-workspace...", true],
		])(
			"should log %s message through Logger",
			(_, expectedMessage, shouldDispose) => {
				const { logger } = createMockOutputChannelWithLogger();
				const mockStorage = createMockStorage({
					writeToCoderOutputChannel: vi.fn((msg: string) => logger.info(msg)),
				});

				const monitor = new WorkspaceMonitor(
					createMockWorkspace({
						owner_name: "test-owner",
						name: "test-workspace",
						id: "test-id",
					}),
					createMockApi(),
					mockStorage,
					createMockVSCode(),
				);

				if (shouldDispose) {
					logger.clear();
					vi.mocked(mockStorage.writeToCoderOutputChannel).mockClear();
					monitor.dispose();
				}

				expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
					expectedMessage,
				);
				const logs = logger.getLogs();
				expect(logs[logs.length - 1].message).toBe(expectedMessage);
			},
		);
	});
});
