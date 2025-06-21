import { Api } from "coder/site/src/api/api";
import { Workspace } from "coder/site/src/api/typesGenerated";
import { ProxyAgent } from "proxy-agent";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { Inbox } from "./inbox";
import { Storage } from "./storage";

// Mock dependencies
vi.mock("ws");
vi.mock("./api");
vi.mock("./api-helper");
vi.mock("./storage");

beforeAll(() => {
	vi.mock("vscode", () => {
		return {};
	});
});

describe("inbox", () => {
	it("should create Inbox instance", () => {
		const mockWorkspace = {} as Workspace;
		const mockHttpAgent = {} as ProxyAgent;
		const mockRestClient = {
			getAxiosInstance: vi.fn(() => ({
				defaults: {
					baseURL: "https://test.com",
					headers: {
						common: {},
					},
				},
			})),
		} as unknown as Api;
		const mockStorage = {} as Storage;

		const inbox = new Inbox(
			mockWorkspace,
			mockHttpAgent,
			mockRestClient,
			mockStorage,
		);

		expect(inbox).toBeInstanceOf(Inbox);
		expect(typeof inbox.dispose).toBe("function");
	});

	it("should throw error when no base URL is set", () => {
		const mockWorkspace = {} as Workspace;
		const mockHttpAgent = {} as ProxyAgent;
		const mockRestClient = {
			getAxiosInstance: vi.fn(() => ({
				defaults: {
					baseURL: undefined,
					headers: {
						common: {},
					},
				},
			})),
		} as unknown as Api;
		const mockStorage = {} as Storage;

		expect(() => {
			new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage);
		}).toThrow("No base URL set on REST client");
	});

	it("should handle dispose method correctly", async () => {
		// Mock WebSocket
		const mockWebSocket = {
			on: vi.fn(),
			close: vi.fn(),
		};
		const { WebSocket: MockWebSocket } = await import("ws");
		vi.mocked(MockWebSocket).mockImplementation(() => mockWebSocket as never);

		const mockWorkspace = { id: "workspace-123" } as Workspace;
		const mockHttpAgent = {} as ProxyAgent;
		const mockRestClient = {
			getAxiosInstance: vi.fn(() => ({
				defaults: {
					baseURL: "https://test.com",
					headers: {
						common: {},
					},
				},
			})),
		} as unknown as Api;
		const mockStorage = {
			writeToCoderOutputChannel: vi.fn(),
		} as unknown as Storage;

		const inbox = new Inbox(
			mockWorkspace,
			mockHttpAgent,
			mockRestClient,
			mockStorage,
		);

		// Call dispose
		inbox.dispose();

		expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
			"No longer listening to Coder Inbox",
		);
		expect(mockWebSocket.close).toHaveBeenCalled();

		// Call dispose again to test the guard
		inbox.dispose();

		// Should not be called again
		expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledTimes(1);
		expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
	});

	it("should handle WebSocket error events", async () => {
		// Mock WebSocket
		let errorHandler: ((error: Error) => void) | undefined;
		const mockWebSocket = {
			on: vi.fn((event, handler) => {
				if (event === "error") {
					errorHandler = handler;
				}
			}),
			close: vi.fn(),
		};
		const { WebSocket: MockWebSocket } = await import("ws");
		vi.mocked(MockWebSocket).mockImplementation(() => mockWebSocket as never);

		// Mock errToStr
		const { errToStr } = await import("./api-helper");
		vi.mocked(errToStr).mockReturnValue("Test error message");

		const mockWorkspace = { id: "workspace-123" } as Workspace;
		const mockHttpAgent = {} as ProxyAgent;
		const mockRestClient = {
			getAxiosInstance: vi.fn(() => ({
				defaults: {
					baseURL: "https://test.com",
					headers: {
						common: {},
					},
				},
			})),
		} as unknown as Api;
		const mockStorage = {
			writeToCoderOutputChannel: vi.fn(),
		} as unknown as Storage;

		new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage);

		// Trigger error event
		const testError = new Error("WebSocket connection failed");
		errorHandler?.(testError);

		expect(errToStr).toHaveBeenCalledWith(
			testError,
			"Got empty error while monitoring Coder Inbox",
		);
		expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
			"Test error message",
		);
		expect(mockWebSocket.close).toHaveBeenCalled();
	});
});
