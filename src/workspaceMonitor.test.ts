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
});
