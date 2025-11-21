import axios, { AxiosError, AxiosHeaders } from "axios";
import { type ProvisionerJobLog } from "coder/site/src/api/typesGenerated";
import { EventSource } from "eventsource";
import { ProxyAgent } from "proxy-agent";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Ws from "ws";

import { CoderApi } from "@/api/coderApi";
import { createHttpAgent } from "@/api/utils";
import { CertificateError } from "@/error";
import { getHeaders } from "@/headers";
import { type RequestConfigWithMeta } from "@/logging/types";
import { ReconnectingWebSocket } from "@/websocket/reconnectingWebSocket";
import { SseConnection } from "@/websocket/sseConnection";

import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

const CODER_URL = "https://coder.example.com";
const AXIOS_TOKEN = "passed-token";
const BUILD_ID = "build-123";
const AGENT_ID = "agent-123";

vi.mock("ws");
vi.mock("eventsource");
vi.mock("proxy-agent");

vi.mock("axios", async () => {
	const actual = await vi.importActual<typeof import("axios")>("axios");

	const mockAdapter = vi.fn(mockAdapterImpl);

	const mockDefault = {
		...actual.default,
		create: vi.fn((config) => {
			const instance = actual.default.create({
				...config,
				adapter: mockAdapter,
			});
			return instance;
		}),
		__mockAdapter: mockAdapter,
	};

	return {
		...actual,
		default: mockDefault,
	};
});

vi.mock("@/headers", () => ({
	getHeaders: vi.fn().mockResolvedValue({}),
	getHeaderCommand: vi.fn(),
}));

vi.mock("@/api/utils", () => ({
	createHttpAgent: vi.fn(),
}));

vi.mock("@/api/streamingFetchAdapter", () => ({
	createStreamingFetchAdapter: vi.fn(() => fetch),
}));

describe("CoderApi", () => {
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockConfig: MockConfigurationProvider;
	let mockAdapter: ReturnType<typeof vi.fn>;
	let api: CoderApi;

	const createApi = (url = CODER_URL, token = AXIOS_TOKEN) => {
		return CoderApi.create(url, token, mockLogger);
	};

	beforeEach(() => {
		vi.resetAllMocks();

		const axiosMock = axios as typeof axios & {
			__mockAdapter: ReturnType<typeof vi.fn>;
		};
		mockAdapter = axiosMock.__mockAdapter;
		mockAdapter.mockImplementation(mockAdapterImpl);

		vi.mocked(getHeaders).mockResolvedValue({});
		mockLogger = createMockLogger();
		mockConfig = new MockConfigurationProvider();
		mockConfig.set("coder.httpClientLogLevel", "BASIC");
	});

	describe("HTTP Interceptors", () => {
		it("adds custom headers and HTTP agent to requests", async () => {
			const mockAgent = new ProxyAgent();
			vi.mocked(createHttpAgent).mockResolvedValue(mockAgent);
			vi.mocked(getHeaders).mockResolvedValue({
				"X-Custom-Header": "custom-value",
				"X-Another-Header": "another-value",
			});

			const api = createApi();
			const response = await api.getAxiosInstance().get("/api/v2/users/me");

			expect(response.config.headers["X-Custom-Header"]).toBe("custom-value");
			expect(response.config.headers["X-Another-Header"]).toBe("another-value");
			expect(response.config.httpsAgent).toBe(mockAgent);
			expect(response.config.httpAgent).toBe(mockAgent);
			expect(response.config.proxy).toBe(false);
		});

		it("wraps certificate errors in response interceptor", async () => {
			const api = createApi();
			const certError = new AxiosError(
				"self signed certificate",
				"DEPTH_ZERO_SELF_SIGNED_CERT",
			);
			mockAdapter.mockRejectedValueOnce(certError);

			const thrownError = await api
				.getAxiosInstance()
				.get("/api/v2/users/me")
				.catch((e) => e);

			expect(thrownError).toBeInstanceOf(CertificateError);
			expect(thrownError.message).toContain("Secure connection");
			expect(thrownError.x509Err).toBeDefined();
		});

		it("applies headers in correct precedence order (command overrides config overrides axios default)", async () => {
			const api = createApi(CODER_URL, AXIOS_TOKEN);

			// Test 1: Headers from config, default token from API creation
			const response = await api.getAxiosInstance().get("/api/v2/users/me", {
				headers: new AxiosHeaders({
					"X-Custom-Header": "from-config",
					"X-Extra": "extra-value",
				}),
			});

			expect(response.config.headers["X-Custom-Header"]).toBe("from-config");
			expect(response.config.headers["X-Extra"]).toBe("extra-value");
			expect(response.config.headers["Coder-Session-Token"]).toBe(AXIOS_TOKEN);

			// Test 2: Token from request options overrides default
			const responseWithToken = await api
				.getAxiosInstance()
				.get("/api/v2/users/me", {
					headers: new AxiosHeaders({
						"Coder-Session-Token": "from-options",
					}),
				});

			expect(responseWithToken.config.headers["Coder-Session-Token"]).toBe(
				"from-options",
			);

			// Test 3: Header command overrides everything
			vi.mocked(getHeaders).mockResolvedValue({
				"Coder-Session-Token": "from-header-command",
			});

			const responseWithHeaderCommand = await api
				.getAxiosInstance()
				.get("/api/v2/users/me", {
					headers: new AxiosHeaders({
						"Coder-Session-Token": "from-options",
					}),
				});

			expect(
				responseWithHeaderCommand.config.headers["Coder-Session-Token"],
			).toBe("from-header-command");
		});

		it("logs requests and responses", async () => {
			const api = createApi();

			await api.getWorkspaces({});

			expect(mockLogger.trace).toHaveBeenCalledWith(
				expect.stringContaining("/api/v2/workspaces"),
			);
		});

		it("calculates request and response sizes in transforms", async () => {
			const api = createApi();
			const response = await api
				.getAxiosInstance()
				.post("/api/v2/workspaces", { name: "test" });

			expect((response.config as RequestConfigWithMeta).rawRequestSize).toBe(
				15,
			);
			// We return the same data we sent in the mock adapter
			expect((response.config as RequestConfigWithMeta).rawResponseSize).toBe(
				15,
			);
		});
	});

	describe("WebSocket Creation", () => {
		const wsUrl = `wss://${CODER_URL.replace("https://", "")}/api/v2/workspacebuilds/${BUILD_ID}/logs?follow=true`;

		beforeEach(() => {
			api = createApi(CODER_URL, AXIOS_TOKEN);
			const mockWs = createMockWebSocket(wsUrl);
			setupWebSocketMock(mockWs);
		});

		it("creates WebSocket with proper headers and configuration", async () => {
			const mockAgent = new ProxyAgent();
			vi.mocked(getHeaders).mockResolvedValue({
				"X-Custom-Header": "custom-value",
			});
			vi.mocked(createHttpAgent).mockResolvedValue(mockAgent);

			await api.watchBuildLogsByBuildId(BUILD_ID, []);

			expect(Ws).toHaveBeenCalledWith(wsUrl, undefined, {
				agent: mockAgent,
				followRedirects: true,
				headers: {
					"X-Custom-Header": "custom-value",
					"Coder-Session-Token": AXIOS_TOKEN,
				},
			});
		});

		it("applies headers in correct precedence order (command overrides config overrides axios default)", async () => {
			// Test 1: Default token from API creation
			await api.watchBuildLogsByBuildId(BUILD_ID, []);

			expect(Ws).toHaveBeenCalledWith(wsUrl, undefined, {
				agent: undefined,
				followRedirects: true,
				headers: {
					"Coder-Session-Token": AXIOS_TOKEN,
				},
			});

			// Test 2: Token from config options overrides default
			await api.watchBuildLogsByBuildId(BUILD_ID, [], {
				headers: {
					"X-Config-Header": "config-value",
					"Coder-Session-Token": "from-config",
				},
			});

			expect(Ws).toHaveBeenCalledWith(wsUrl, undefined, {
				agent: undefined,
				followRedirects: true,
				headers: {
					"Coder-Session-Token": "from-config",
					"X-Config-Header": "config-value",
				},
			});

			// Test 3: Header command overrides everything
			vi.mocked(getHeaders).mockResolvedValue({
				"Coder-Session-Token": "from-header-command",
			});

			await api.watchBuildLogsByBuildId(BUILD_ID, [], {
				headers: {
					"Coder-Session-Token": "from-config",
				},
			});

			expect(Ws).toHaveBeenCalledWith(wsUrl, undefined, {
				agent: undefined,
				followRedirects: true,
				headers: {
					"Coder-Session-Token": "from-header-command",
				},
			});
		});

		it("logs WebSocket connections", async () => {
			await api.watchBuildLogsByBuildId(BUILD_ID, []);

			expect(mockLogger.trace).toHaveBeenCalledWith(
				expect.stringContaining(BUILD_ID),
			);
		});

		it("'watchBuildLogsByBuildId' includes after parameter for existing logs", async () => {
			const jobLog: ProvisionerJobLog = {
				created_at: new Date().toISOString(),
				id: 1,
				output: "log1",
				log_source: "provisioner",
				log_level: "info",
				stage: "stage1",
			};
			const existingLogs = [
				jobLog,
				{ ...jobLog, id: 20 },
				{ ...jobLog, id: 5 },
			];

			await api.watchBuildLogsByBuildId(BUILD_ID, existingLogs);

			expect(Ws).toHaveBeenCalledWith(
				expect.stringContaining("after=5"),
				undefined,
				expect.any(Object),
			);
		});
	});

	describe("SSE Fallback", () => {
		beforeEach(() => {
			api = createApi();
			const mockEventSource = createMockEventSource(
				`${CODER_URL}/api/v2/workspaces/123/watch`,
			);
			setupEventSourceMock(mockEventSource);
		});

		it("uses WebSocket when no errors occur", async () => {
			const mockWs = createMockWebSocket(
				`wss://${CODER_URL.replace("https://", "")}/api/v2/workspaceagents/${AGENT_ID}/watch-metadata`,
				{
					on: vi.fn((event, handler) => {
						if (event === "open") {
							setImmediate(() => handler());
						}
						return mockWs as Ws;
					}),
				},
			);
			setupWebSocketMock(mockWs);

			const connection = await api.watchAgentMetadata(AGENT_ID);

			expect(connection).toBeInstanceOf(ReconnectingWebSocket);
			expect(EventSource).not.toHaveBeenCalled();
		});

		it("falls back to SSE when WebSocket creation fails", async () => {
			vi.mocked(Ws).mockImplementation(() => {
				throw new Error("WebSocket creation failed");
			});

			const connection = await api.watchAgentMetadata(AGENT_ID);

			expect(connection).toBeInstanceOf(SseConnection);
			expect(EventSource).toHaveBeenCalled();
		});

		it("falls back to SSE on 404 error from WebSocket", async () => {
			const mockWs = createMockWebSocket(
				`wss://${CODER_URL.replace("https://", "")}/api/v2/test`,
				{
					on: vi.fn((event: string, handler: (e: unknown) => void) => {
						if (event === "error") {
							setImmediate(() => {
								handler({
									error: new Error("404 Not Found"),
									message: "404 Not Found",
								});
							});
						}
						return mockWs as Ws;
					}),
				},
			);
			setupWebSocketMock(mockWs);

			const connection = await api.watchAgentMetadata(AGENT_ID);

			expect(connection).toBeInstanceOf(SseConnection);
			expect(EventSource).toHaveBeenCalled();
		});
	});

	describe("Reconnection on Host/Token Changes", () => {
		const setupAutoOpeningWebSocket = () => {
			const sockets: Array<Partial<Ws>> = [];
			vi.mocked(Ws).mockImplementation((url: string | URL) => {
				const mockWs = createMockWebSocket(String(url), {
					on: vi.fn((event, handler) => {
						if (event === "open") {
							setImmediate(() => handler());
						}
						return mockWs as Ws;
					}),
				});
				sockets.push(mockWs);
				return mockWs as Ws;
			});
			return sockets;
		};

		it("triggers reconnection when session token changes", async () => {
			const sockets = setupAutoOpeningWebSocket();
			api = createApi(CODER_URL, AXIOS_TOKEN);
			await api.watchAgentMetadata(AGENT_ID);

			api.setSessionToken("new-token");
			await new Promise((resolve) => setImmediate(resolve));

			expect(sockets[0].close).toHaveBeenCalledWith(
				1000,
				"Replacing connection",
			);
			expect(sockets).toHaveLength(2);
		});

		it("triggers reconnection when host changes", async () => {
			const sockets = setupAutoOpeningWebSocket();
			api = createApi(CODER_URL, AXIOS_TOKEN);
			const wsWrap = await api.watchAgentMetadata(AGENT_ID);
			expect(wsWrap.url).toContain(CODER_URL.replace("http", "ws"));

			api.setHost("https://new-coder.example.com");
			await new Promise((resolve) => setImmediate(resolve));

			expect(sockets[0].close).toHaveBeenCalledWith(
				1000,
				"Replacing connection",
			);
			expect(sockets).toHaveLength(2);
			expect(wsWrap.url).toContain("wss://new-coder.example.com");
		});

		it("does not reconnect when token or host are unchanged", async () => {
			const sockets = setupAutoOpeningWebSocket();
			api = createApi(CODER_URL, AXIOS_TOKEN);
			await api.watchAgentMetadata(AGENT_ID);

			// Same values as before
			api.setSessionToken(AXIOS_TOKEN);
			api.setHost(CODER_URL);

			expect(sockets[0].close).not.toHaveBeenCalled();
			expect(sockets).toHaveLength(1);
		});
	});

	describe("Error Handling", () => {
		it("throws error when no base URL is set", async () => {
			const api = createApi();
			api.getAxiosInstance().defaults.baseURL = undefined;

			await expect(api.watchBuildLogsByBuildId(BUILD_ID, [])).rejects.toThrow(
				"No base URL set on REST client",
			);
		});
	});
});

const mockAdapterImpl = vi.hoisted(() => (config: Record<string, unknown>) => {
	return Promise.resolve({
		data: config.data || "{}",
		status: 200,
		statusText: "OK",
		headers: {},
		config,
	});
});

function createMockWebSocket(
	url: string,
	overrides?: Partial<Ws>,
): Partial<Ws> {
	return {
		url,
		on: vi.fn(),
		off: vi.fn(),
		close: vi.fn(),
		...overrides,
	};
}

function createMockEventSource(url: string): Partial<EventSource> {
	return {
		url,
		readyState: EventSource.CONNECTING,
		addEventListener: vi.fn((event, handler) => {
			if (event === "open") {
				setImmediate(() => handler(new Event("open")));
			}
		}),
		removeEventListener: vi.fn(),
		close: vi.fn(),
	};
}

function setupWebSocketMock(ws: Partial<Ws>): void {
	vi.mocked(Ws).mockImplementation(() => ws as Ws);
}

function setupEventSourceMock(es: Partial<EventSource>): void {
	vi.mocked(EventSource).mockImplementation(() => es as EventSource);
}
