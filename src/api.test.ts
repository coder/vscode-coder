import { spawn } from "child_process";
import { Api } from "coder/site/src/api/api";
import * as fs from "fs/promises";
import { ProxyAgent } from "proxy-agent";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import { WebSocket } from "ws";
import {
	needToken,
	createHttpAgent,
	makeCoderSdk,
	createStreamingFetchAdapter,
	startWorkspaceIfStoppedOrFailed,
	waitForBuild,
	coderSessionTokenHeader,
} from "./api";
import { errToStr } from "./api-helper";
import { getHeaderArgs } from "./headers";
import { getProxyForUrl } from "./proxy";
import {
	createMockConfiguration,
	createMockStorage,
	createMockApi,
	createMockChildProcess,
	createMockWebSocket,
	createMockAxiosInstance,
} from "./test-helpers";
import { expandPath } from "./util";

// Setup all mocks
function setupMocks() {
	vi.mock("fs/promises");
	vi.mock("proxy-agent");
	vi.mock("./proxy");
	vi.mock("./headers");
	vi.mock("./util");
	vi.mock("./error");
	vi.mock("./api-helper");
	vi.mock("child_process");
	vi.mock("ws");
	vi.mock("coder/site/src/api/api");

	vi.mock("vscode", async () => {
		const helpers = await import("./test-helpers");
		return helpers.createMockVSCode();
	});
}

setupMocks();

describe("api", () => {
	// Mock VS Code configuration
	const mockConfiguration = createMockConfiguration();

	// Mock API and axios
	const mockAxiosInstance = createMockAxiosInstance();

	let mockApi: ReturnType<typeof createMockApi>;

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset configuration mock to return empty values by default
		mockConfiguration.get.mockReturnValue("");

		// Setup vscode mock
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
			mockConfiguration,
		);

		// Setup API mock (after clearAllMocks)
		mockApi = createMockApi({
			getAxiosInstance: vi.fn().mockReturnValue(mockAxiosInstance),
		});
		vi.mocked(Api).mockImplementation(() => mockApi as never);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("needToken", () => {
		it.each([
			[
				"should return true when no cert or key files are configured",
				{ "coder.tlsCertFile": "", "coder.tlsKeyFile": "" },
				true,
			],
			[
				"should return false when cert file is configured",
				{ "coder.tlsCertFile": "/path/to/cert.pem", "coder.tlsKeyFile": "" },
				false,
			],
			[
				"should return false when key file is configured",
				{ "coder.tlsCertFile": "", "coder.tlsKeyFile": "/path/to/key.pem" },
				false,
			],
			[
				"should return false when both cert and key files are configured",
				{
					"coder.tlsCertFile": "/path/to/cert.pem",
					"coder.tlsKeyFile": "/path/to/key.pem",
				},
				false,
			],
			[
				"should handle null config values",
				{ "coder.tlsCertFile": null, "coder.tlsKeyFile": null },
				true,
			],
			[
				"should handle undefined config values",
				{ "coder.tlsCertFile": undefined, "coder.tlsKeyFile": undefined },
				true,
			],
			["should handle missing config entries", {}, true],
		])("%s", (_, configValues: Record<string, unknown>, expected) => {
			mockConfiguration.get.mockImplementation((key: string) => {
				if (key in configValues) {
					return configValues[key];
				}
				return undefined;
			});

			// Mock expandPath to return the path as-is
			vi.mocked(expandPath).mockImplementation((path: string) => path);

			const result = needToken();

			expect(result).toBe(expected);
			if (expected) {
				expect(vscode.workspace.getConfiguration).toHaveBeenCalled();
			}
		});
	});

	describe("createHttpAgent", () => {
		beforeEach(() => {
			vi.mocked(fs.readFile).mockResolvedValue(
				Buffer.from("mock-file-content"),
			);
			vi.mocked(expandPath).mockImplementation((path: string) => path);
			vi.mocked(getProxyForUrl).mockReturnValue("http://proxy:8080");
		});

		it.each([
			[
				"default configuration",
				{},
				{
					cert: undefined,
					key: undefined,
					ca: undefined,
					servername: undefined,
					rejectUnauthorized: true,
				},
			],
			[
				"insecure configuration",
				{ "coder.insecure": true },
				{
					cert: undefined,
					key: undefined,
					ca: undefined,
					servername: undefined,
					rejectUnauthorized: false,
				},
			],
			[
				"TLS certificate files",
				{
					"coder.tlsCertFile": "/path/to/cert.pem",
					"coder.tlsKeyFile": "/path/to/key.pem",
					"coder.tlsCaFile": "/path/to/ca.pem",
					"coder.tlsAltHost": "alternative.host.com",
				},
				{
					cert: Buffer.from("cert-content"),
					key: Buffer.from("key-content"),
					ca: Buffer.from("ca-content"),
					servername: "alternative.host.com",
					rejectUnauthorized: true,
				},
			],
			[
				"undefined configuration values",
				{
					"coder.tlsCertFile": undefined,
					"coder.tlsKeyFile": undefined,
					"coder.tlsCaFile": undefined,
					"coder.tlsAltHost": undefined,
					"coder.insecure": undefined,
				},
				{
					cert: undefined,
					key: undefined,
					ca: undefined,
					servername: undefined,
					rejectUnauthorized: true,
				},
			],
		])(
			"should create ProxyAgent with %s",
			async (_, configValues: Record<string, unknown>, expectedAgentConfig) => {
				mockConfiguration.get.mockImplementation((key: string) => {
					if (key in configValues) {
						return configValues[key];
					}
					return undefined;
				});

				if (configValues["coder.tlsCertFile"]) {
					vi.mocked(fs.readFile)
						.mockResolvedValueOnce(Buffer.from("cert-content"))
						.mockResolvedValueOnce(Buffer.from("key-content"))
						.mockResolvedValueOnce(Buffer.from("ca-content"));
				}

				await createHttpAgent();

				if (configValues["coder.tlsCertFile"]) {
					expect(fs.readFile).toHaveBeenCalledWith("/path/to/cert.pem");
					expect(fs.readFile).toHaveBeenCalledWith("/path/to/key.pem");
					expect(fs.readFile).toHaveBeenCalledWith("/path/to/ca.pem");
				}

				expect(ProxyAgent).toHaveBeenCalledWith({
					getProxyForUrl: expect.any(Function),
					...expectedAgentConfig,
				});
			},
		);

		it("should handle getProxyForUrl callback", async () => {
			mockConfiguration.get.mockReturnValue("");

			await createHttpAgent();

			const proxyAgentCall = vi.mocked(ProxyAgent).mock.calls[0]?.[0];
			const getProxyForUrlFn = proxyAgentCall?.getProxyForUrl;

			// Test the getProxyForUrl callback
			if (getProxyForUrlFn) {
				getProxyForUrlFn("https://example.com");
			}

			expect(vi.mocked(getProxyForUrl)).toHaveBeenCalledWith(
				"https://example.com",
				"", // http.proxy
				"", // coder.proxyBypass
			);
		});
	});

	describe("makeCoderSdk", () => {
		beforeEach(() => {
			const mockCreateHttpAgent = vi.fn().mockResolvedValue(new ProxyAgent({}));
			vi.doMock("./api", async () => {
				const actual = await vi.importActual<typeof import("./api")>("./api");
				return { ...actual, createHttpAgent: mockCreateHttpAgent };
			});
		});

		it.each([
			["with token", "test-token", { "Custom-Header": "value" }, true],
			["without token", undefined, {}, false],
		])("%s", (_, token, headers, shouldSetToken) => {
			const mockStorage = createMockStorage({
				getHeaders: vi.fn().mockResolvedValue(headers),
			});

			const result = makeCoderSdk(
				"https://coder.example.com",
				token,
				mockStorage,
			);

			expect(mockApi.setHost).toHaveBeenCalledWith("https://coder.example.com");
			if (shouldSetToken) {
				expect(mockApi.setSessionToken).toHaveBeenCalledWith(token);
			} else {
				expect(mockApi.setSessionToken).not.toHaveBeenCalled();
			}
			expect(result).toBe(mockApi);
		});

		it("should configure request interceptor correctly", async () => {
			const mockStorage = createMockStorage({
				getHeaders: vi.fn().mockResolvedValue({ "Custom-Header": "value" }),
			});

			makeCoderSdk("https://coder.example.com", "test-token", mockStorage);

			// Get the request interceptor callback
			const requestInterceptorCall = vi.mocked(
				mockAxiosInstance.interceptors.request.use,
			).mock.calls[0];
			const requestInterceptor = requestInterceptorCall[0];

			// Test the request interceptor
			const mockConfig = {
				headers: {},
			};

			const result = await requestInterceptor(mockConfig);

			expect(mockStorage.getHeaders).toHaveBeenCalledWith(
				"https://coder.example.com",
			);
			expect(result.headers["Custom-Header"]).toBe("value");
			expect(result.httpsAgent).toBeDefined();
			expect(result.httpAgent).toBeDefined();
			expect(result.proxy).toBe(false);
		});

		it("should configure response interceptor correctly", async () => {
			const mockStorage = createMockStorage({
				getHeaders: vi.fn().mockResolvedValue({}),
			});

			const { CertificateError } = await import("./error");
			vi.spyOn(CertificateError, "maybeWrap").mockRejectedValue(
				new Error("Certificate error"),
			);

			makeCoderSdk("https://coder.example.com", "test-token", mockStorage);

			const [successCallback, errorCallback] = vi.mocked(
				mockAxiosInstance.interceptors.response.use,
			).mock.calls[0];

			// Test success callback
			const mockResponse = { data: "test" };
			expect(successCallback(mockResponse)).toBe(mockResponse);

			// Test error callback
			const mockError = new Error("Network error");
			await expect(errorCallback(mockError)).rejects.toThrow(
				"Certificate error",
			);
			expect(CertificateError.maybeWrap).toHaveBeenCalledWith(
				mockError,
				"https://coder.example.com",
				mockStorage,
			);
		});
	});

	describe("createStreamingFetchAdapter", () => {
		const createMockAxiosResponse = (overrides = {}) => ({
			data: { on: vi.fn(), destroy: vi.fn() },
			status: 200,
			headers: { "content-type": "application/json" },
			request: { res: { responseUrl: "https://example.com/api" } },
			...overrides,
		});

		it("should create fetch adapter that streams responses", async () => {
			const mockAxiosInstance = {
				request: vi.fn().mockResolvedValue(createMockAxiosResponse()),
			};

			const adapter = createStreamingFetchAdapter(mockAxiosInstance as never);

			// Mock ReadableStream
			global.ReadableStream = vi.fn().mockImplementation((options) => {
				if (options.start) {
					options.start({ enqueue: vi.fn(), close: vi.fn(), error: vi.fn() });
				}
				return { getReader: vi.fn(() => ({ read: vi.fn() })) };
			}) as never;

			const result = await adapter("https://example.com/api", {
				headers: { Authorization: "Bearer token" },
			});

			expect(mockAxiosInstance.request).toHaveBeenCalledWith({
				url: "https://example.com/api",
				signal: undefined,
				headers: { Authorization: "Bearer token" },
				responseType: "stream",
				validateStatus: expect.any(Function),
			});

			expect(result).toMatchObject({
				url: "https://example.com/api",
				status: 200,
				redirected: false,
			});
			expect(result.headers.get("content-type")).toBe("application/json");
			expect(result.headers.get("nonexistent")).toBe(null);
		});

		it("should handle URL objects", async () => {
			const mockAxiosInstance = {
				request: vi.fn().mockResolvedValue(createMockAxiosResponse()),
			};

			const adapter = createStreamingFetchAdapter(mockAxiosInstance as never);
			await adapter(new URL("https://example.com/api"));

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({ url: "https://example.com/api" }),
			);
		});

		it("should handle stream data events", async () => {
			let dataHandler: (chunk: Buffer) => void;
			const mockData = {
				on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
					if (event === "data") {
						dataHandler = handler;
					}
				}),
				destroy: vi.fn(),
			};

			const mockAxiosInstance = {
				request: vi
					.fn()
					.mockResolvedValue(createMockAxiosResponse({ data: mockData })),
			};

			const adapter = createStreamingFetchAdapter(mockAxiosInstance as never);

			let enqueuedData: Buffer | undefined;
			global.ReadableStream = vi.fn().mockImplementation((options) => {
				const controller = {
					enqueue: vi.fn((chunk: Buffer) => {
						enqueuedData = chunk;
					}),
					close: vi.fn(),
					error: vi.fn(),
				};
				if (options.start) {
					options.start(controller);
				}
				return { getReader: vi.fn(() => ({ read: vi.fn() })) };
			}) as never;

			await adapter("https://example.com/api");

			// Simulate data event
			const testData = Buffer.from("test data");
			dataHandler!(testData);

			expect(enqueuedData).toEqual(testData);
			expect(mockData.on).toHaveBeenCalledWith("data", expect.any(Function));
		});

		it("should handle stream end event", async () => {
			let endHandler: () => void;
			const mockData = {
				on: vi.fn((event: string, handler: () => void) => {
					if (event === "end") {
						endHandler = handler;
					}
				}),
				destroy: vi.fn(),
			};

			const mockAxiosInstance = {
				request: vi
					.fn()
					.mockResolvedValue(createMockAxiosResponse({ data: mockData })),
			};

			const adapter = createStreamingFetchAdapter(mockAxiosInstance as never);

			let streamClosed = false;
			global.ReadableStream = vi.fn().mockImplementation((options) => {
				const controller = {
					enqueue: vi.fn(),
					close: vi.fn(() => {
						streamClosed = true;
					}),
					error: vi.fn(),
				};
				if (options.start) {
					options.start(controller);
				}
				return { getReader: vi.fn(() => ({ read: vi.fn() })) };
			}) as never;

			await adapter("https://example.com/api");

			// Simulate end event
			endHandler!();

			expect(streamClosed).toBe(true);
			expect(mockData.on).toHaveBeenCalledWith("end", expect.any(Function));
		});

		it("should handle stream error event", async () => {
			let errorHandler: (err: Error) => void;
			const mockData = {
				on: vi.fn((event: string, handler: (err: Error) => void) => {
					if (event === "error") {
						errorHandler = handler;
					}
				}),
				destroy: vi.fn(),
			};

			const mockAxiosInstance = {
				request: vi
					.fn()
					.mockResolvedValue(createMockAxiosResponse({ data: mockData })),
			};

			const adapter = createStreamingFetchAdapter(mockAxiosInstance as never);

			let streamError: Error | undefined;
			global.ReadableStream = vi.fn().mockImplementation((options) => {
				const controller = {
					enqueue: vi.fn(),
					close: vi.fn(),
					error: vi.fn((err: Error) => {
						streamError = err;
					}),
				};
				if (options.start) {
					options.start(controller);
				}
				return { getReader: vi.fn(() => ({ read: vi.fn() })) };
			}) as never;

			await adapter("https://example.com/api");

			// Simulate error event
			const testError = new Error("Stream error");
			errorHandler!(testError);

			expect(streamError).toBe(testError);
			expect(mockData.on).toHaveBeenCalledWith("error", expect.any(Function));
		});

		it("should handle stream cancel", async () => {
			const mockData = {
				on: vi.fn(),
				destroy: vi.fn(),
			};

			const mockAxiosInstance = {
				request: vi
					.fn()
					.mockResolvedValue(createMockAxiosResponse({ data: mockData })),
			};

			const adapter = createStreamingFetchAdapter(mockAxiosInstance as never);

			let cancelFunction: (() => Promise<void>) | undefined;
			global.ReadableStream = vi.fn().mockImplementation((options) => {
				if (options.cancel) {
					cancelFunction = options.cancel;
				}
				if (options.start) {
					options.start({ enqueue: vi.fn(), close: vi.fn(), error: vi.fn() });
				}
				return { getReader: vi.fn(() => ({ read: vi.fn() })) };
			}) as never;

			await adapter("https://example.com/api");

			// Call cancel
			expect(cancelFunction).toBeDefined();
			await cancelFunction!();

			expect(mockData.destroy).toHaveBeenCalled();
		});
	});

	describe("startWorkspaceIfStoppedOrFailed", () => {
		const createWorkspaceTest = (
			status: string,
			overrides?: Record<string, unknown>,
		) => ({
			id: "workspace-1",
			owner_name: "user",
			name: "workspace",
			latest_build: { status },
			...overrides,
		});

		it("should return workspace if already running", async () => {
			const mockWorkspace = createWorkspaceTest("running");
			const mockRestClient = createMockApi({
				getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
			});

			const result = await startWorkspaceIfStoppedOrFailed(
				mockRestClient,
				"/config",
				"/bin/coder",
				mockWorkspace as never,
				new vscode.EventEmitter<string>(),
			);

			expect(result).toBe(mockWorkspace);
			expect(mockRestClient.getWorkspace).toHaveBeenCalledWith("workspace-1");
		});

		it("should start workspace if stopped", async () => {
			const stoppedWorkspace = createWorkspaceTest("stopped");
			const runningWorkspace = createWorkspaceTest("running");

			const mockRestClient = createMockApi({
				getWorkspace: vi
					.fn()
					.mockResolvedValueOnce(stoppedWorkspace)
					.mockResolvedValueOnce(runningWorkspace),
			});

			const mockProcess = createMockChildProcess();
			vi.mocked(spawn).mockReturnValue(mockProcess as never);
			vi.mocked(getHeaderArgs).mockReturnValue(["--header", "key=value"]);

			const resultPromise = startWorkspaceIfStoppedOrFailed(
				mockRestClient,
				"/config",
				"/bin/coder",
				stoppedWorkspace as never,
				new vscode.EventEmitter<string>(),
			);

			setTimeout(() => mockProcess.emit("close", 0), 10);
			const result = await resultPromise;

			expect(vi.mocked(spawn)).toHaveBeenCalledWith("/bin/coder", [
				"--global-config",
				"/config",
				"--header",
				"key=value",
				"start",
				"--yes",
				"user/workspace",
			]);
			expect(result).toBe(runningWorkspace);
		});

		it("should handle process failure", async () => {
			const failedWorkspace = createWorkspaceTest("failed");
			const mockRestClient = createMockApi({
				getWorkspace: vi.fn().mockResolvedValue(failedWorkspace),
			});

			const mockProcess = createMockChildProcess();
			vi.mocked(spawn).mockReturnValue(mockProcess as never);
			vi.mocked(getHeaderArgs).mockReturnValue([]);

			const resultPromise = startWorkspaceIfStoppedOrFailed(
				mockRestClient,
				"/config",
				"/bin/coder",
				failedWorkspace as never,
				new vscode.EventEmitter<string>(),
			);

			setTimeout(() => {
				mockProcess.stderr.emit("data", Buffer.from("Error occurred"));
				mockProcess.emit("close", 1);
			}, 10);

			await expect(resultPromise).rejects.toThrow(
				'"--global-config /config start --yes user/workspace" exited with code 1: Error occurred',
			);
		});
	});

	describe("waitForBuild", () => {
		const createBuildTest = (
			buildId = "build-1",
			workspaceId = "workspace-1",
		) => ({
			mockWorkspace: {
				id: workspaceId,
				latest_build: { id: buildId, status: "running" },
			},
			mockWriteEmitter: new vscode.EventEmitter<string>(),
			mockSocket: createMockWebSocket(),
		});

		it("should wait for build completion and return updated workspace", async () => {
			const { mockWorkspace, mockWriteEmitter, mockSocket } = createBuildTest();

			const mockRestClient = createMockApi({
				getWorkspaceBuildLogs: vi.fn().mockResolvedValue([
					{ id: 1, output: "Starting build..." },
					{ id: 2, output: "Build in progress..." },
				]),
				getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://coder.example.com",
						headers: { common: { [coderSessionTokenHeader]: "test-token" } },
					},
				})),
			});

			vi.mocked(WebSocket).mockImplementation(() => mockSocket as never);

			const resultPromise = waitForBuild(
				mockRestClient,
				mockWriteEmitter,
				mockWorkspace as never,
			);

			setTimeout(() => {
				mockSocket.emit(
					"message",
					Buffer.from(JSON.stringify({ output: "Build complete" })),
				);
				mockSocket.emit("close");
			}, 10);

			const result = await resultPromise;

			expect(mockRestClient.getWorkspaceBuildLogs).toHaveBeenCalledWith(
				"build-1",
			);
			expect(mockRestClient.getWorkspace).toHaveBeenCalledWith("workspace-1");
			expect(result).toBeDefined();
			expect(WebSocket).toHaveBeenCalledWith(
				expect.any(URL),
				expect.objectContaining({
					headers: { [coderSessionTokenHeader]: "test-token" },
				}),
			);
		});

		it("should handle WebSocket errors", async () => {
			const { mockWorkspace, mockWriteEmitter, mockSocket } = createBuildTest();
			const mockRestClient = createMockApi({
				getWorkspaceBuildLogs: vi.fn().mockResolvedValue([]),
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://coder.example.com",
						headers: { common: {} },
					},
				})),
			});

			vi.mocked(WebSocket).mockImplementation(() => mockSocket as never);
			vi.mocked(errToStr).mockReturnValue("connection failed");

			const resultPromise = waitForBuild(
				mockRestClient,
				mockWriteEmitter,
				mockWorkspace as never,
			);

			setTimeout(
				() => mockSocket.emit("error", new Error("Connection failed")),
				10,
			);

			await expect(resultPromise).rejects.toThrow(
				"Failed to watch workspace build using wss://coder.example.com/api/v2/workspacebuilds/build-1/logs?follow=true: connection failed",
			);
		});

		it("should handle missing base URL", async () => {
			const mockWorkspace = {
				latest_build: { id: "build-1" },
			};

			const mockRestClient = createMockApi({
				getAxiosInstance: vi.fn(() => ({
					defaults: {},
				})),
			});

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			await expect(
				waitForBuild(mockRestClient, mockWriteEmitter, mockWorkspace as never),
			).rejects.toThrow("No base URL set on REST client");
		});

		it.skip("should handle malformed URL errors in try-catch", async () => {
			const mockWorkspace = {
				id: "workspace-1",
				latest_build: { id: "build-1" },
			};

			const mockRestClient = createMockApi({
				getWorkspaceBuildLogs: vi.fn().mockResolvedValue([]),
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "invalid-url://this-will-fail",
						headers: { common: {} },
					},
				})),
			});

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			// Mock WebSocket constructor to throw an error (simulating malformed URL)
			vi.mocked(WebSocket).mockImplementation(() => {
				throw new Error("Invalid URL");
			});

			// Mock errToStr
			vi.mocked(errToStr).mockReturnValue("malformed URL");

			await expect(
				waitForBuild(mockRestClient, mockWriteEmitter, mockWorkspace as never),
			).rejects.toThrow(
				"Failed to watch workspace build on invalid-url://this-will-fail: malformed URL",
			);
		});

		it("should handle logs with after parameter", async () => {
			const mockWorkspace = {
				id: "workspace-1",
				latest_build: { id: "build-1", status: "running" },
			};
			const mockRestClient = createMockApi({
				getWorkspaceBuildLogs: vi.fn().mockResolvedValue([
					{ id: 10, output: "Starting build..." },
					{ id: 20, output: "Build in progress..." },
				]),
				getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://coder.example.com",
						headers: { common: {} },
					},
				})),
			});

			const mockWriteEmitter = new vscode.EventEmitter<string>();
			const mockSocket = createMockWebSocket();
			vi.mocked(WebSocket).mockImplementation(() => mockSocket as never);

			const resultPromise = waitForBuild(
				mockRestClient,
				mockWriteEmitter,
				mockWorkspace as never,
			);
			setTimeout(() => mockSocket.emit("close"), 10);
			await resultPromise;

			const websocketCalls = vi.mocked(WebSocket).mock.calls;
			expect(websocketCalls).toHaveLength(1);
			expect((websocketCalls[0][0] as URL).href).toBe(
				"wss://coder.example.com/api/v2/workspacebuilds/build-1/logs?follow=true&after=20",
			);
		});

		it("should handle WebSocket without auth token", async () => {
			const mockWorkspace = {
				id: "workspace-1",
				latest_build: { id: "build-1", status: "running" },
			};
			const mockRestClient = createMockApi({
				getWorkspaceBuildLogs: vi.fn().mockResolvedValue([]),
				getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://coder.example.com",
						headers: { common: {} },
					},
				})),
			});

			const mockWriteEmitter = new vscode.EventEmitter<string>();
			const mockSocket = createMockWebSocket();
			vi.mocked(WebSocket).mockImplementation(() => mockSocket as never);

			const resultPromise = waitForBuild(
				mockRestClient,
				mockWriteEmitter,
				mockWorkspace as never,
			);
			setTimeout(() => mockSocket.emit("close"), 10);
			await resultPromise;

			const websocketCalls = vi.mocked(WebSocket).mock.calls;
			expect((websocketCalls[0][0] as URL).href).toBe(
				"wss://coder.example.com/api/v2/workspacebuilds/build-1/logs?follow=true",
			);
			expect(websocketCalls[0][1]).toMatchObject({
				followRedirects: true,
				headers: undefined,
			});
		});
	});
});
