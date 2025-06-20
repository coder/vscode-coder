import { describe, it, expect, vi, beforeEach } from "vitest";
import { Remote } from "./remote";

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
vi.mock("./cliManager");
vi.mock("./commands");
vi.mock("./featureSet");
vi.mock("./headers");
vi.mock("./inbox");
vi.mock("./sshConfig");
vi.mock("./sshSupport");
vi.mock("./storage");
vi.mock("./util");
vi.mock("./workspaceMonitor");

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
}));

beforeEach(() => {
	// Clear all mocks before each test
	vi.clearAllMocks();
});

describe("remote", () => {
	it("should export Remote class", () => {
		expect(typeof Remote).toBe("function");
		expect(Remote.prototype.constructor).toBe(Remote);
	});
});
