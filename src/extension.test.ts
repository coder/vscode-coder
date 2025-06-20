import { describe, it, expect, vi, beforeEach } from "vitest";
import * as extension from "./extension";

// Mock dependencies
vi.mock("axios", () => ({
	default: {
		create: vi.fn(() => ({
			defaults: {
				headers: { common: {} },
				baseURL: "https://test.com",
			},
			interceptors: {
				request: { use: vi.fn() },
				response: { use: vi.fn() },
			},
		})),
	},
}));
vi.mock("coder/site/src/api/api", () => ({
	Api: class MockApi {
		setHost = vi.fn();
		setSessionToken = vi.fn();
		getAxiosInstance = vi.fn(() => ({
			defaults: {
				headers: { common: {} },
				baseURL: "https://test.com",
			},
			interceptors: {
				request: { use: vi.fn() },
				response: { use: vi.fn() },
			},
		}));
	},
}));
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./commands");
vi.mock("./error");
vi.mock("./remote");
vi.mock("./storage");
vi.mock("./util");
vi.mock("./workspacesProvider");

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
	EventEmitter: class MockEventEmitter {
		fire = vi.fn();
		event = vi.fn();
		dispose = vi.fn();
	},
	TreeItem: class MockTreeItem {
		constructor() {
			// Mock implementation
		}
	},
	TreeItemCollapsibleState: {
		None: 0,
		Collapsed: 1,
		Expanded: 2,
	},
}));

beforeEach(() => {
	// Clear all mocks before each test
	vi.clearAllMocks();
});

describe("extension", () => {
	it("should export activate function", () => {
		expect(typeof extension.activate).toBe("function");
	});

	// Note: deactivate function is not exported from extension.ts
});
