import { Workspace } from "coder/site/src/api/typesGenerated";
import { describe, it, expect, vi, beforeAll } from "vitest";
import {
	getPrivateProperty,
	createMockWorkspace,
	createMockApi,
	createMockStorage,
	createMockVSCode,
	createMockWorkspaceRunning,
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

	describe("statusBar", () => {
		it("should show status bar when workspace is outdated", () => {
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
			updateStatusBar.call(monitor, createMockWorkspace({ outdated: true }));

			expect(statusBarItem.show).toHaveBeenCalled();
			expect(statusBarItem.hide).not.toHaveBeenCalled();
		});
	});
});
