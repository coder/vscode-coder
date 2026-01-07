import axios, {
	AxiosError,
	AxiosHeaders,
	type CreateAxiosDefaults,
	type InternalAxiosRequestConfig,
} from "axios";
import { type ProvisionerJobLog } from "coder/site/src/api/typesGenerated";
import { EventSource } from "eventsource";
import { ProxyAgent } from "proxy-agent";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import Ws from "ws";

import { CoderApi } from "@/api/coderApi";
import { createHttpAgent } from "@/api/utils";
import { CertificateError } from "@/error/certificateError";
import { getHeaders } from "@/headers";
import { type RequestConfigWithMeta } from "@/logging/types";
import { ReconnectingWebSocket } from "@/websocket/reconnectingWebSocket";

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
		create: vi.fn((config: CreateAxiosDefaults) => {
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
	let mockAdapter: Mock<
		(config: InternalAxiosRequestConfig) => Promise<unknown>
	>;
	let api: CoderApi;

	const createApi = (url = CODER_URL, token = AXIOS_TOKEN) => {
		return CoderApi.create(url, token, mockLogger);
	};

	beforeEach(() => {
		vi.resetAllMocks();

		const axiosMock = axios as typeof axios & {
			__mockAdapter: Mock<
				(config: InternalAxiosRequestConfig) => Promise<unknown>
			>;
		};
		mockAdapter = axiosMock.__mockAdapter;
		mockAdapter.mockImplementation(mockAdapterImpl);

		vi.mocked(getHeaders).mockResolvedValue({});
		mockLogger = createMockLogger();
		mockConfig = new MockConfigurationProvider();
		mockConfig.set("coder.httpClientLogLevel", "BASIC");
	});

	afterEach(() => {
		// Dispose any api created during the test to clean up config watchers
		api?.dispose();
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

			const castError = thrownError as CertificateError;
			expect(castError.message).toContain("Secure connection");
			expect(castError.x509Err).toBeDefined();
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

		it("falls back to SSE when WebSocket creation fails with 404", async () => {
			// Only 404 errors trigger SSE fallback - other errors are thrown
			vi.mocked(Ws).mockImplementation(function () {
				throw new Error("Unexpected server response: 404");
			});

			const connection = await api.watchAgentMetadata(AGENT_ID);

			// Returns ReconnectingWebSocket (which wraps SSE internally)
			expect(connection).toBeInstanceOf(ReconnectingWebSocket);
			expect(EventSource).toHaveBeenCalled();
		});

		it("falls back to SSE on 404 error from WebSocket open", async () => {
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

			// Returns ReconnectingWebSocket (which wraps SSE internally after WS 404)
			expect(connection).toBeInstanceOf(ReconnectingWebSocket);
			expect(EventSource).toHaveBeenCalled();
		});

		it("throws non-404 errors without SSE fallback", async () => {
			vi.mocked(Ws).mockImplementation(function () {
				throw new Error("Network error");
			});

			await expect(api.watchAgentMetadata(AGENT_ID)).rejects.toThrow(
				"Network error",
			);
			expect(EventSource).not.toHaveBeenCalled();
		});

		describe("reconnection after fallback", () => {
			beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
			afterEach(() => vi.useRealTimers());

			it("reconnects after SSE fallback and retries WS on each reconnect", async () => {
				let wsAttempts = 0;
				const mockEventSources: MockEventSource[] = [];

				vi.mocked(Ws).mockImplementation(function () {
					wsAttempts++;
					const mockWs = createMockWebSocket("wss://test", {
						on: vi.fn((event: string, handler: (e: unknown) => void) => {
							if (event === "error") {
								setImmediate(() =>
									handler({ error: new Error("Something 404") }),
								);
							}
							return mockWs as Ws;
						}),
					});
					return mockWs as Ws;
				});

				vi.mocked(EventSource).mockImplementation(function () {
					const es = createMockEventSource(`${CODER_URL}/api/v2/test`);
					mockEventSources.push(es);
					return es as unknown as EventSource;
				});

				const connection = await api.watchAgentMetadata(AGENT_ID);
				expect(wsAttempts).toBe(1);
				expect(EventSource).toHaveBeenCalledTimes(1);

				mockEventSources[0].fireError();
				await vi.advanceTimersByTimeAsync(300);

				expect(wsAttempts).toBe(2);
				expect(EventSource).toHaveBeenCalledTimes(2);

				connection.close();
			});
		});
	});

	const setupAutoOpeningWebSocket = () => {
		const sockets: Array<Partial<Ws>> = [];
		vi.mocked(Ws).mockImplementation(function (url: string | URL) {
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

	describe("Reconnection on Host/Token Changes", () => {
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
			// Wait for the async reconnect to complete (factory is async)
			await new Promise((resolve) => setImmediate(resolve));

			expect(sockets[0].close).toHaveBeenCalledWith(
				1000,
				"Replacing connection",
			);
			expect(sockets).toHaveLength(2);
			// Verify the new socket was created with the correct URL
			expect(sockets[1].url).toContain("wss://new-coder.example.com");
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

		it("suspends sockets when host is set to empty string (logout)", async () => {
			const sockets = setupAutoOpeningWebSocket();
			api = createApi(CODER_URL, AXIOS_TOKEN);
			await api.watchAgentMetadata(AGENT_ID);

			// Setting host to empty string (logout) should suspend (not permanently close)
			api.setHost("");
			await new Promise((resolve) => setImmediate(resolve));

			expect(sockets[0].close).toHaveBeenCalledWith(1000, "Host cleared");
			expect(sockets).toHaveLength(1);
		});

		it("does not reconnect when setting token after clearing host", async () => {
			const sockets = setupAutoOpeningWebSocket();
			api = createApi(CODER_URL, AXIOS_TOKEN);
			await api.watchAgentMetadata(AGENT_ID);

			api.setHost("");
			api.setSessionToken("new-token");
			await new Promise((resolve) => setImmediate(resolve));

			// Should only have the initial socket - no reconnection after token change
			expect(sockets).toHaveLength(1);
			expect(sockets[0].close).toHaveBeenCalledWith(1000, "Host cleared");
		});

		it("setCredentials sets both host and token together", async () => {
			const sockets = setupAutoOpeningWebSocket();
			api = createApi(CODER_URL, AXIOS_TOKEN);
			await api.watchAgentMetadata(AGENT_ID);

			api.setCredentials("https://new-coder.example.com", "new-token");
			await new Promise((resolve) => setImmediate(resolve));

			// Should reconnect only once despite both values changing
			expect(sockets).toHaveLength(2);
			expect(sockets[1].url).toContain("wss://new-coder.example.com");
		});

		it("setCredentials suspends when host is cleared", async () => {
			const sockets = setupAutoOpeningWebSocket();
			api = createApi(CODER_URL, AXIOS_TOKEN);
			await api.watchAgentMetadata(AGENT_ID);

			api.setCredentials(undefined, undefined);
			await new Promise((resolve) => setImmediate(resolve));

			expect(sockets).toHaveLength(1);
			expect(sockets[0].close).toHaveBeenCalledWith(1000, "Host cleared");
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

	describe("getHost/getSessionToken", () => {
		it("returns current host and token", () => {
			const api = createApi(CODER_URL, AXIOS_TOKEN);

			expect(api.getHost()).toBe(CODER_URL);
			expect(api.getSessionToken()).toBe(AXIOS_TOKEN);
		});
	});

	describe("dispose", () => {
		it("disposes all tracked reconnecting sockets", async () => {
			const sockets: Array<Partial<Ws>> = [];
			vi.mocked(Ws).mockImplementation(function (url: string | URL) {
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

			api = createApi(CODER_URL, AXIOS_TOKEN);
			await api.watchAgentMetadata(AGENT_ID);
			expect(sockets).toHaveLength(1);

			api.dispose();

			// Socket should be closed
			expect(sockets[0].close).toHaveBeenCalled();
		});
	});

	describe("Configuration Change Reconnection", () => {
		const tick = () => new Promise((resolve) => setImmediate(resolve));

		it("reconnects sockets when watched config value changes", async () => {
			mockConfig.set("coder.insecure", false);
			const sockets = setupAutoOpeningWebSocket();
			api = createApi(CODER_URL, AXIOS_TOKEN);
			await api.watchAgentMetadata(AGENT_ID);

			mockConfig.set("coder.insecure", true);
			await tick();

			expect(sockets[0].close).toHaveBeenCalledWith(
				1000,
				"Replacing connection",
			);
			expect(sockets).toHaveLength(2);
		});

		it.each([
			["unchanged value", "coder.insecure", false],
			["unrelated setting", "unrelated.setting", "new-value"],
		])("does not reconnect for %s", async (_desc, key, value) => {
			mockConfig.set("coder.insecure", false);
			const sockets = setupAutoOpeningWebSocket();
			api = createApi(CODER_URL, AXIOS_TOKEN);
			await api.watchAgentMetadata(AGENT_ID);

			mockConfig.set(key, value);
			await tick();

			expect(sockets[0].close).not.toHaveBeenCalled();
			expect(sockets).toHaveLength(1);
		});

		it("stops watching after dispose", async () => {
			mockConfig.set("coder.insecure", false);
			const sockets = setupAutoOpeningWebSocket();
			api = createApi(CODER_URL, AXIOS_TOKEN);
			await api.watchAgentMetadata(AGENT_ID);

			api.dispose();
			mockConfig.set("coder.insecure", true);
			await tick();

			expect(sockets).toHaveLength(1);
		});
	});
});

const mockAdapterImpl = vi.hoisted(
	() => (config: InternalAxiosRequestConfig) => {
		return Promise.resolve({
			data: config.data || "{}",
			status: 200,
			statusText: "OK",
			headers: {},
			config,
		});
	},
);

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

type MockEventSource = Partial<EventSource> & {
	readyState: number;
	fireOpen: () => void;
	fireError: () => void;
};

function createMockEventSource(url: string): MockEventSource {
	const handlers: Record<string, ((e: Event) => void) | undefined> = {};
	const mock: MockEventSource = {
		url,
		readyState: EventSource.CONNECTING,
		addEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
			handlers[event] = handler;
			if (event === "open") {
				setImmediate(() => handler(new Event("open")));
			}
		}),
		removeEventListener: vi.fn(),
		close: vi.fn(),
		fireOpen: () => handlers.open?.(new Event("open")),
		fireError: () => {
			mock.readyState = EventSource.CLOSED;
			handlers.error?.(new Event("error"));
		},
	};
	return mock;
}

function setupWebSocketMock(ws: Partial<Ws>): void {
	vi.mocked(Ws).mockImplementation(function () {
		return ws as Ws;
	});
}

function setupEventSourceMock(es: Partial<EventSource>): void {
	vi.mocked(EventSource).mockImplementation(function () {
		return es as EventSource;
	});
}
