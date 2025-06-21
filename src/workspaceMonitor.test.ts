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
});
