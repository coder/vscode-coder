import { Api } from "coder/site/src/api/api";
import { Workspace } from "coder/site/src/api/typesGenerated";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { Storage } from "./storage";
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
	vi.mock("vscode", () => {
		return {
			EventEmitter: class MockEventEmitter {
				fire = vi.fn();
				event = vi.fn();
				dispose = vi.fn();
			},
			window: {
				createStatusBarItem: vi.fn(() => ({
					hide: vi.fn(),
					show: vi.fn(),
					dispose: vi.fn(),
				})),
				showInformationMessage: vi.fn(),
			},
			StatusBarAlignment: {
				Left: 1,
				Right: 2,
			},
			commands: {
				executeCommand: vi.fn(),
			},
		};
	});
});

describe("workspaceMonitor", () => {
	it("should create WorkspaceMonitor instance", () => {
		const mockWorkspace = {} as Workspace;
		const mockRestClient = {
			getAxiosInstance: vi.fn(() => ({
				defaults: { baseURL: "https://test.com" },
			})),
		} as unknown as Api;
		const mockStorage = {
			writeToCoderOutputChannel: vi.fn(),
		} as unknown as Storage;
		const mockVscodeProposed = {} as unknown as typeof import("vscode");

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
			const mockWorkspace = {
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
			} as Workspace;

			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.com" },
				})),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const mockVscodeProposed = {} as unknown as typeof import("vscode");

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Spy on the private properties - we need to access them to verify cleanup
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const monitorAny = monitor as any;
			const closeSpy = vi.spyOn(monitorAny.eventSource, "close");
			const disposeSpy = vi.spyOn(monitorAny.statusBarItem, "dispose");

			// Call dispose
			monitor.dispose();

			// Verify cleanup
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Unmonitoring test-owner/test-workspace...",
			);
			expect(disposeSpy).toHaveBeenCalled();
			expect(closeSpy).toHaveBeenCalled();

			// Verify disposed flag is set
			expect(monitorAny.disposed).toBe(true);
		});

		it("should not dispose twice when called multiple times", () => {
			const mockWorkspace = {
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
			} as Workspace;

			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.com" },
				})),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const mockVscodeProposed = {} as unknown as typeof import("vscode");

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const monitorAny = monitor as any;
			const closeSpy = vi.spyOn(monitorAny.eventSource, "close");
			const disposeSpy = vi.spyOn(monitorAny.statusBarItem, "dispose");

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
			const mockWorkspace = {
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
				latest_build: {
					status: "running",
					deadline: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes from now
				},
			} as Workspace;

			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.com" },
				})),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const mockVscodeProposed = {} as unknown as typeof import("vscode");

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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(monitor as any).maybeNotifyAutostop(mockWorkspace);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("is scheduled to shut down in"),
			);
		});
	});

	describe("isImpending", () => {
		it("should return true when target time is within notify window", () => {
			const mockWorkspace = {} as Workspace;
			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.com" },
				})),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const mockVscodeProposed = {} as unknown as typeof import("vscode");

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// Test with a target time 10 minutes from now and 30-minute notify window
			const targetTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			const notifyTime = 30 * 60 * 1000; // 30 minutes

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (monitor as any).isImpending(targetTime, notifyTime);

			expect(result).toBe(true);
		});

		it("should return false when target time is beyond notify window", () => {
			const mockWorkspace = {} as Workspace;
			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.com" },
				})),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const mockVscodeProposed = {} as unknown as typeof import("vscode");

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

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (monitor as any).isImpending(targetTime, notifyTime);

			expect(result).toBe(false);
		});
	});

	describe("updateStatusBar", () => {
		it("should show status bar when workspace is outdated", () => {
			const mockWorkspace = {
				outdated: false,
			} as Workspace;
			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.com" },
				})),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const mockVscodeProposed = {} as unknown as typeof import("vscode");

			const monitor = new WorkspaceMonitor(
				mockWorkspace,
				mockRestClient,
				mockStorage,
				mockVscodeProposed,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const monitorAny = monitor as any;
			const showSpy = vi.spyOn(monitorAny.statusBarItem, "show");
			const hideSpy = vi.spyOn(monitorAny.statusBarItem, "hide");

			// Test outdated workspace
			const outdatedWorkspace = { outdated: true } as Workspace;
			monitorAny.updateStatusBar(outdatedWorkspace);
			expect(showSpy).toHaveBeenCalled();
			expect(hideSpy).not.toHaveBeenCalled();

			// Clear mocks
			showSpy.mockClear();
			hideSpy.mockClear();

			// Test up-to-date workspace
			const currentWorkspace = { outdated: false } as Workspace;
			monitorAny.updateStatusBar(currentWorkspace);
			expect(hideSpy).toHaveBeenCalled();
			expect(showSpy).not.toHaveBeenCalled();
		});
	});

	describe("notifyError", () => {
		it("should write error to output channel", () => {
			const mockWorkspace = {} as Workspace;
			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.com" },
				})),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const mockVscodeProposed = {} as unknown as typeof import("vscode");

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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(monitor as any).notifyError(testError);

			// Verify error was written to output channel
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				expect.any(String),
			);

			vi.doUnmock("./api-helper");
		});
	});

	describe("maybeNotifyDeletion", () => {
		it("should notify about impending deletion when workspace has deleting_at and deadline is soon", async () => {
			const mockWorkspace = {
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
				deleting_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // 12 hours from now
			} as Workspace;

			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.com" },
				})),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const mockVscodeProposed = {} as unknown as typeof import("vscode");

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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(monitor as any).maybeNotifyDeletion(mockWorkspace);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("is scheduled for deletion in"),
			);
		});
	});

	describe("maybeNotifyNotRunning", () => {
		it("should notify and offer reload when workspace is not running", async () => {
			const mockWorkspace = {
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
				latest_build: {
					status: "stopped",
				},
			} as Workspace;

			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.com" },
				})),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;

			// Mock vscodeProposed with showInformationMessage
			const mockShowInformationMessage = vi
				.fn()
				.mockResolvedValue("Reload Window");
			const mockVscodeProposed = {
				window: {
					showInformationMessage: mockShowInformationMessage,
				},
			} as unknown as typeof import("vscode");

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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (monitor as any).maybeNotifyNotRunning(mockWorkspace);

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
			const mockWorkspace = {
				owner_name: "test-owner",
				name: "test-workspace",
				id: "test-id",
				template_id: "template-123",
				outdated: true,
			} as Workspace;

			const mockTemplate = {
				active_version_id: "version-456",
			};

			const mockTemplateVersion = {
				message: "New version with improved performance",
			};

			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: { baseURL: "https://test.com" },
				})),
				getTemplate: vi.fn().mockResolvedValue(mockTemplate),
				getTemplateVersion: vi.fn().mockResolvedValue(mockTemplateVersion),
			} as unknown as Api;
			const mockStorage = {
				writeToCoderOutputChannel: vi.fn(),
			} as unknown as Storage;
			const mockVscodeProposed = {} as unknown as typeof import("vscode");

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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await (monitor as any).maybeNotifyOutdated(mockWorkspace);

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
});
