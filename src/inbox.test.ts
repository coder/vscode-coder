import { describe, it, expect, vi, beforeAll } from "vitest";
import { Inbox } from "./inbox";
import {
	createMockWorkspace,
	createMockApi,
	createMockStorage,
	createMockProxyAgent,
	createMockWebSocket,
	createMockAxiosInstance,
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
	it("should handle dispose method correctly", async () => {
		// Mock WebSocket
		const mockWebSocket = createMockWebSocket();
		const { WebSocket: MockWebSocket } = await import("ws");
		vi.mocked(MockWebSocket).mockImplementation(() => mockWebSocket as never);

		const mockWorkspace = createMockWorkspace({ id: "workspace-123" });
		const mockHttpAgent = createMockProxyAgent();
		const mockRestClient = createMockApi({
			getAxiosInstance: vi.fn(() =>
				createMockAxiosInstance({
					defaults: {
						baseURL: "https://test.com",
						headers: { common: {} },
					},
				}),
			),
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
});
