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
import { OneWayWebSocket } from "@/websocket/oneWayWebSocket";
import { SseConnection } from "@/websocket/sseConnection";

import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

vi.mock("ws");
vi.mock("eventsource");
vi.mock("proxy-agent");

const mockAdapterImpl = vi.hoisted(() => (config: Record<string, unknown>) => {
	return Promise.resolve({
		data: config.data || "{}",
		status: 200,
		statusText: "OK",
		headers: {},
		config,
	});
});

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

			const api = CoderApi.create(
				"https://coder.example.com",
				"token",
				mockLogger,
			);

			const response = await api.getAxiosInstance().get("/api/v2/users/me");

			expect(response.config.headers["X-Custom-Header"]).toBe("custom-value");
			expect(response.config.headers["X-Another-Header"]).toBe("another-value");
			expect(response.config.httpsAgent).toBe(mockAgent);
			expect(response.config.httpAgent).toBe(mockAgent);
			expect(response.config.proxy).toBe(false);
		});

		it("wraps certificate errors in response interceptor", async () => {
			const api = CoderApi.create(
				"https://coder.example.com",
				"token",
				mockLogger,
			);

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

		it("applies headers in correct precedence order", async () => {
			vi.mocked(getHeaders).mockResolvedValue({
				"X-Custom-Header": "from-command",
				"Coder-Session-Token": "from-header-command",
			});

			const api = CoderApi.create(
				"https://coder.example.com",
				"passed-token",
				mockLogger,
			);

			const response = await api.getAxiosInstance().get("/api/v2/users/me", {
				headers: new AxiosHeaders({
					"X-Custom-Header": "from-config",
					"X-Extra": "extra-value",
					"Coder-Session-Token": "ignored-token",
				}),
			});

			expect(response.config.headers["X-Custom-Header"]).toBe("from-command");
			expect(response.config.headers["X-Extra"]).toBe("extra-value");
			expect(response.config.headers["Coder-Session-Token"]).toBe(
				"from-header-command",
			);
		});

		it("logs requests and responses", async () => {
			const api = CoderApi.create(
				"https://coder.example.com",
				"token",
				mockLogger,
			);

			await api.getWorkspaces({});

			expect(mockLogger.trace).toHaveBeenCalledWith(
				expect.stringContaining("/api/v2/workspaces"),
			);
		});

		it("calculates request and response sizes in transforms", async () => {
			const api = CoderApi.create(
				"https://coder.example.com",
				"token",
				mockLogger,
			);

			const response = await api
				.getAxiosInstance()
				.post("/api/v2/workspaces", { name: "test" });

			expect((response.config as RequestConfigWithMeta).rawRequestSize).toBe(
				15,
			);
			// We return the same data we sent in the mock adapter.
			expect((response.config as RequestConfigWithMeta).rawResponseSize).toBe(
				15,
			);
		});
	});

	describe("WebSocket Creation", () => {
		const buildId = "build-123";
		const wsUrl = `wss://coder.example.com/api/v2/workspacebuilds/${buildId}/logs?follow=true`;
		let api: CoderApi;

		beforeEach(() => {
			api = CoderApi.create(
				"https://coder.example.com",
				"passed-token",
				mockLogger,
			);

			// Mock all WS as "WatchBuildLogsByBuildId"
			const mockWs = {
				url: wsUrl,
				on: vi.fn(),
				off: vi.fn(),
				close: vi.fn(),
			} as Partial<Ws>;
			vi.mocked(Ws).mockImplementation(() => mockWs as Ws);
		});

		it("creates WebSocket with proper headers and configuration", async () => {
			const mockAgent = new ProxyAgent();
			vi.mocked(getHeaders).mockResolvedValue({
				"X-Custom-Header": "custom-value",
			});
			vi.mocked(createHttpAgent).mockResolvedValue(mockAgent);

			await api.watchBuildLogsByBuildId(buildId, []);

			expect(Ws).toHaveBeenCalledWith(wsUrl, undefined, {
				agent: mockAgent,
				followRedirects: true,
				headers: {
					"X-Custom-Header": "custom-value",
					"Coder-Session-Token": "passed-token",
				},
			});
		});

		it("applies headers in correct precedence order", async () => {
			vi.mocked(getHeaders).mockResolvedValue({
				"X-Custom-Header": "from-command",
				"Coder-Session-Token": "from-header-command",
			});

			await api.watchBuildLogsByBuildId(buildId, []);

			expect(Ws).toHaveBeenCalledWith(wsUrl, undefined, {
				agent: undefined,
				followRedirects: true,
				headers: {
					"X-Custom-Header": "from-command",
					"Coder-Session-Token": "passed-token",
				},
			});
		});

		it("logs WebSocket connections", async () => {
			await api.watchBuildLogsByBuildId(buildId, []);

			expect(mockLogger.trace).toHaveBeenCalledWith(
				expect.stringContaining(buildId),
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
			const existingLogs = [jobLog, { ...jobLog, id: 20 }];

			await api.watchBuildLogsByBuildId(buildId, existingLogs);

			expect(Ws).toHaveBeenCalledWith(
				expect.stringContaining("after=20"),
				undefined,
				expect.any(Object),
			);
		});
	});

	describe("SSE Fallback", () => {
		let api: CoderApi;

		beforeEach(() => {
			api = CoderApi.create("https://coder.example.com", "token", mockLogger);

			const mockEventSource = {
				url: "https://coder.example.com/api/v2/workspaces/123/watch",
				readyState: EventSource.CONNECTING,
				addEventListener: vi.fn((event, handler) => {
					if (event === "open") {
						setImmediate(() => handler(new Event("open")));
					}
				}),
				removeEventListener: vi.fn(),
				close: vi.fn(),
			};

			vi.mocked(EventSource).mockImplementation(
				() => mockEventSource as unknown as EventSource,
			);
		});

		it("uses WebSocket when no errors occur", async () => {
			const mockWs: Partial<Ws> = {
				url: "wss://coder.example.com/api/v2/workspaceagents/agent-123/watch-metadata",
				on: vi.fn((event, handler) => {
					if (event === "open") {
						setImmediate(() => handler());
					}
					return mockWs as Ws;
				}),
				off: vi.fn(),
				close: vi.fn(),
			};
			vi.mocked(Ws).mockImplementation(() => mockWs as Ws);

			const connection = await api.watchAgentMetadata("agent-123");

			expect(connection).toBeInstanceOf(OneWayWebSocket);
			expect(EventSource).not.toHaveBeenCalled();
		});

		it("falls back to SSE when WebSocket creation fails", async () => {
			vi.mocked(Ws).mockImplementation(() => {
				throw new Error("WebSocket creation failed");
			});

			const connection = await api.watchAgentMetadata("agent-123");
			expect(connection).toBeInstanceOf(SseConnection);
			expect(EventSource).toHaveBeenCalled();
		});

		it("falls back to SSE on 404 error from WebSocket", async () => {
			const mockWs: Partial<Ws> = {
				url: "wss://coder.example.com/api/v2/test",
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
				off: vi.fn(),
				close: vi.fn(),
			};

			vi.mocked(Ws).mockImplementation(() => mockWs as Ws);

			const connection = await api.watchAgentMetadata("agent-123");
			expect(connection).toBeInstanceOf(SseConnection);
			expect(EventSource).toHaveBeenCalled();
		});
	});

	describe("Error Handling", () => {
		it("throws error when no base URL is set", async () => {
			const api = CoderApi.create(
				"https://coder.example.com",
				"token",
				mockLogger,
			);

			api.getAxiosInstance().defaults.baseURL = undefined;

			await expect(
				api.watchBuildLogsByBuildId("build-123", []),
			).rejects.toThrow("No base URL set on REST client");
		});
	});
});
