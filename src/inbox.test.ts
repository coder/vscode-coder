import { describe, it, expect, vi, beforeAll } from "vitest";
import { Inbox } from "./inbox";
import {
	createMockOutputChannelWithLogger,
	createMockWorkspace,
	createMockApi,
	createMockStorage,
	createMockProxyAgent,
} from "./test-helpers";

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
		const mockWorkspace = createMockWorkspace();
		const mockHttpAgent = createMockProxyAgent();
		const mockRestClient = createMockApi({
			getAxiosInstance: vi.fn(() => ({
				defaults: {
					baseURL: "https://test.com",
					headers: {
						common: {},
					},
				},
			})),
		});
		const mockStorage = createMockStorage();

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
		const mockWorkspace = createMockWorkspace();
		const mockHttpAgent = createMockProxyAgent();
		const mockRestClient = createMockApi({
			getAxiosInstance: vi.fn(() => ({
				defaults: {
					baseURL: undefined,
					headers: {
						common: {},
					},
				},
			})),
		});
		const mockStorage = createMockStorage();

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

		const mockWorkspace = createMockWorkspace({ id: "workspace-123" });
		const mockHttpAgent = createMockProxyAgent();
		const mockRestClient = createMockApi({
			getAxiosInstance: vi.fn(() => ({
				defaults: {
					baseURL: "https://test.com",
					headers: {
						common: {},
					},
				},
			})),
		});
		const mockStorage = createMockStorage({
			writeToCoderOutputChannel: vi.fn(),
		});

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

		const mockWorkspace = createMockWorkspace({ id: "workspace-123" });
		const mockHttpAgent = createMockProxyAgent();
		const mockRestClient = createMockApi({
			getAxiosInstance: vi.fn(() => ({
				defaults: {
					baseURL: "https://test.com",
					headers: {
						common: {},
					},
				},
			})),
		});
		const mockStorage = createMockStorage({
			writeToCoderOutputChannel: vi.fn(),
		});

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

	describe("Logger integration", () => {
		it("should log messages through Logger when Storage has Logger set", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Mock WebSocket
			let openHandler: (() => void) | undefined;
			const mockWebSocket = {
				on: vi.fn((event, handler) => {
					if (event === "open") {
						openHandler = handler;
					}
				}),
				close: vi.fn(),
			};
			const { WebSocket: MockWebSocket } = await import("ws");
			vi.mocked(MockWebSocket).mockImplementation(() => mockWebSocket as never);

			const mockWorkspace = createMockWorkspace({ id: "workspace-123" });
			const mockHttpAgent = createMockProxyAgent();
			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://test.com",
						headers: {
							common: {},
						},
					},
				})),
			});

			// Create mock Storage that uses Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.info(msg);
				}),
			});

			new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage);

			// Trigger open event
			openHandler?.();

			// Verify "Listening to Coder Inbox" was logged
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"Listening to Coder Inbox",
			);

			const logs = logger.getLogs();
			expect(logs.length).toBe(1);
			expect(logs[0].message).toBe("Listening to Coder Inbox");
			expect(logs[0].level).toBe("INFO");
		});

		it("should log dispose message through Logger", async () => {
			const { logger } = createMockOutputChannelWithLogger();

			// Mock WebSocket
			const mockWebSocket = {
				on: vi.fn(),
				close: vi.fn(),
			};
			const { WebSocket: MockWebSocket } = await import("ws");
			vi.mocked(MockWebSocket).mockImplementation(() => mockWebSocket as never);

			const mockWorkspace = createMockWorkspace({ id: "workspace-123" });
			const mockHttpAgent = createMockProxyAgent();
			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://test.com",
						headers: {
							common: {},
						},
					},
				})),
			});

			// Create mock Storage that uses Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.info(msg);
				}),
			});

			const inbox = new Inbox(
				mockWorkspace,
				mockHttpAgent,
				mockRestClient,
				mockStorage,
			);

			// Clear any logs from initialization
			logger.clear();
			vi.mocked(mockStorage.writeToCoderOutputChannel).mockClear();

			// Dispose
			inbox.dispose();

			// Verify dispose message was logged
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"No longer listening to Coder Inbox",
			);

			const logs = logger.getLogs();
			expect(logs.length).toBe(1);
			expect(logs[0].message).toBe("No longer listening to Coder Inbox");
		});

		it("should log error messages through Logger", async () => {
			const { logger } = createMockOutputChannelWithLogger();

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
			vi.mocked(errToStr).mockReturnValue("WebSocket connection error");

			const mockWorkspace = createMockWorkspace({ id: "workspace-123" });
			const mockHttpAgent = createMockProxyAgent();
			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://test.com",
						headers: {
							common: {},
						},
					},
				})),
			});

			// Create mock Storage that uses Logger
			const mockStorage = createMockStorage({
				writeToCoderOutputChannel: vi.fn((msg: string) => {
					logger.info(msg);
				}),
			});

			new Inbox(mockWorkspace, mockHttpAgent, mockRestClient, mockStorage);

			// Clear any logs from initialization
			logger.clear();
			vi.mocked(mockStorage.writeToCoderOutputChannel).mockClear();

			// Trigger error event
			const testError = new Error("Test WebSocket error");
			errorHandler?.(testError);

			// Verify error was logged
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledWith(
				"WebSocket connection error",
			);

			// The second call should be for "No longer listening to Coder Inbox"
			// because the error handler calls dispose()
			expect(mockStorage.writeToCoderOutputChannel).toHaveBeenCalledTimes(2);

			const logs = logger.getLogs();
			expect(logs.length).toBe(2);
			expect(logs[0].message).toBe("WebSocket connection error");
			expect(logs[1].message).toBe("No longer listening to Coder Inbox");
		});
	});
});
