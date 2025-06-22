import { spawn } from "child_process";
import { Api } from "coder/site/src/api/api";
import { EventEmitter } from "events";
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
import { createMockConfiguration, createMockStorage } from "./test-helpers";
import { expandPath } from "./util";

// Mock dependencies
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

describe("api", () => {
	// Mock VS Code configuration
	const mockConfiguration = createMockConfiguration();

	// Mock API and axios
	const mockAxiosInstance = {
		interceptors: {
			request: {
				use: vi.fn(),
			},
			response: {
				use: vi.fn(),
			},
		},
	};

	const mockApi = {
		setHost: vi.fn(),
		setSessionToken: vi.fn(),
		getAxiosInstance: vi.fn().mockReturnValue(mockAxiosInstance),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset configuration mock to return empty values by default
		mockConfiguration.get.mockReturnValue("");

		// Setup vscode mock
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
			mockConfiguration,
		);

		// Setup API mock (after clearAllMocks)
		vi.mocked(Api).mockImplementation(() => mockApi as any);
		// Re-setup the getAxiosInstance mock after clearAllMocks
		mockApi.getAxiosInstance.mockReturnValue(mockAxiosInstance);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe("needToken", () => {
		it("should return true when no cert or key files are configured", () => {
			mockConfiguration.get.mockImplementation((key: string) => {
				if (key === "coder.tlsCertFile" || key === "coder.tlsKeyFile") {
					return "";
				}
				return "";
			});

			const result = needToken();

			expect(result).toBe(true);
			expect(vscode.workspace.getConfiguration).toHaveBeenCalled();
		});

		it("should return false when cert file is configured", () => {
			mockConfiguration.get.mockImplementation((key: string) => {
				if (key === "coder.tlsCertFile") {
					return "/path/to/cert.pem";
				}
				return "";
			});

			// Mock expandPath to return the path as-is
			vi.mocked(expandPath).mockReturnValue("/path/to/cert.pem");

			const result = needToken();

			expect(result).toBe(false);
		});

		it("should return false when key file is configured", () => {
			mockConfiguration.get.mockImplementation((key: string) => {
				if (key === "coder.tlsKeyFile") {
					return "/path/to/key.pem";
				}
				return "";
			});

			// Mock expandPath to return the path as-is
			vi.mocked(expandPath).mockReturnValue("/path/to/key.pem");

			const result = needToken();

			expect(result).toBe(false);
		});

		it("should return false when both cert and key files are configured", () => {
			mockConfiguration.get.mockImplementation((key: string) => {
				if (key === "coder.tlsCertFile") {
					return "/path/to/cert.pem";
				}
				if (key === "coder.tlsKeyFile") {
					return "/path/to/key.pem";
				}
				return "";
			});

			// Mock expandPath to return the path as-is
			vi.mocked(expandPath).mockImplementation((path: string) => path);

			const result = needToken();

			expect(result).toBe(false);
		});

		it("should handle null/undefined config values", () => {
			mockConfiguration.get.mockImplementation((key: string) => {
				if (key === "coder.tlsCertFile" || key === "coder.tlsKeyFile") {
					return null;
				}
				return "";
			});

			const result = needToken();

			expect(result).toBe(true);
		});
	});

	describe("createHttpAgent", () => {
		beforeEach(() => {
			// Mock fs.readFile to return buffer data
			vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("mock-file-content"));

			// Mock expandPath to return paths as-is
			vi.mocked(expandPath).mockImplementation((path: string) => path);

			// Mock getProxyForUrl
			vi.mocked(getProxyForUrl).mockReturnValue("http://proxy:8080");
		});

		it("should create ProxyAgent with default configuration", async () => {
			mockConfiguration.get.mockReturnValue("");

			await createHttpAgent();

			expect(ProxyAgent).toHaveBeenCalledWith({
				getProxyForUrl: expect.any(Function),
				cert: undefined,
				key: undefined,
				ca: undefined,
				servername: undefined,
				rejectUnauthorized: true,
			});
		});

		it("should create ProxyAgent with insecure configuration", async () => {
			mockConfiguration.get.mockImplementation((key: string) => {
				if (key === "coder.insecure") {
					return true;
				}
				return "";
			});

			await createHttpAgent();

			expect(ProxyAgent).toHaveBeenCalledWith({
				getProxyForUrl: expect.any(Function),
				cert: undefined,
				key: undefined,
				ca: undefined,
				servername: undefined,
				rejectUnauthorized: false,
			});
		});

		it("should create ProxyAgent with TLS certificate files", async () => {
			mockConfiguration.get.mockImplementation((key: string) => {
				switch (key) {
					case "coder.tlsCertFile":
						return "/path/to/cert.pem";
					case "coder.tlsKeyFile":
						return "/path/to/key.pem";
					case "coder.tlsCaFile":
						return "/path/to/ca.pem";
					case "coder.tlsAltHost":
						return "alternative.host.com";
					default:
						return "";
				}
			});

			const mockCertBuffer = Buffer.from("cert-content");
			const mockKeyBuffer = Buffer.from("key-content");
			const mockCaBuffer = Buffer.from("ca-content");

			vi.mocked(fs.readFile)
				.mockResolvedValueOnce(mockCertBuffer)
				.mockResolvedValueOnce(mockKeyBuffer)
				.mockResolvedValueOnce(mockCaBuffer);

			await createHttpAgent();

			expect(fs.readFile).toHaveBeenCalledWith("/path/to/cert.pem");
			expect(fs.readFile).toHaveBeenCalledWith("/path/to/key.pem");
			expect(fs.readFile).toHaveBeenCalledWith("/path/to/ca.pem");

			expect(ProxyAgent).toHaveBeenCalledWith({
				getProxyForUrl: expect.any(Function),
				cert: mockCertBuffer,
				key: mockKeyBuffer,
				ca: mockCaBuffer,
				servername: "alternative.host.com",
				rejectUnauthorized: true,
			});
		});

		it("should handle getProxyForUrl callback", async () => {
			mockConfiguration.get.mockReturnValue("");

			await createHttpAgent();

			const proxyAgentCall = vi.mocked(ProxyAgent).mock.calls[0][0];
			const getProxyForUrlFn = proxyAgentCall.getProxyForUrl;

			// Test the getProxyForUrl callback
			getProxyForUrlFn("https://example.com");

			expect(vi.mocked(getProxyForUrl)).toHaveBeenCalledWith(
				"https://example.com",
				"", // http.proxy
				"", // coder.proxyBypass
			);
		});
	});

	describe("makeCoderSdk", () => {
		let mockCreateHttpAgent: any;

		beforeEach(() => {
			// Mock createHttpAgent
			mockCreateHttpAgent = vi.fn().mockResolvedValue(new ProxyAgent({}));
			vi.doMock("./api", async () => {
				const actual = (await vi.importActual("./api")) as any;
				return {
					...actual,
					createHttpAgent: mockCreateHttpAgent,
				};
			});
		});

		it("should create and configure API instance with token", () => {
			const mockStorage = createMockStorage({
				getHeaders: vi.fn().mockResolvedValue({ "Custom-Header": "value" }),
			});

			const result = makeCoderSdk(
				"https://coder.example.com",
				"test-token",
				mockStorage,
			);

			expect(mockApi.setHost).toHaveBeenCalledWith("https://coder.example.com");
			expect(mockApi.setSessionToken).toHaveBeenCalledWith("test-token");
			expect(result).toBe(mockApi);
		});

		it("should create API instance without token", () => {
			const mockStorage = createMockStorage({
				getHeaders: vi.fn().mockResolvedValue({}),
			});

			const result = makeCoderSdk(
				"https://coder.example.com",
				undefined,
				mockStorage,
			);

			expect(mockApi.setHost).toHaveBeenCalledWith("https://coder.example.com");
			expect(mockApi.setSessionToken).not.toHaveBeenCalled();
			expect(result).toBe(mockApi);
		});

		it("should configure request interceptor correctly", async () => {
			const mockStorage = createMockStorage({
				getHeaders: vi.fn().mockResolvedValue({ "Custom-Header": "value" }),
			});

			makeCoderSdk("https://coder.example.com", "test-token", mockStorage);

			// Get the request interceptor callback
			const requestInterceptorCall =
				mockAxiosInstance.interceptors.request.use.mock.calls[0];
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

			// Mock CertificateError.maybeWrap
			const { CertificateError } = await import("./error");
			const mockMaybeWrap = vi
				.fn()
				.mockRejectedValue(new Error("Certificate error"));
			vi.spyOn(CertificateError, "maybeWrap").mockImplementation(mockMaybeWrap);

			makeCoderSdk("https://coder.example.com", "test-token", mockStorage);

			// Get the response interceptor callbacks
			const responseInterceptorCall =
				mockAxiosInstance.interceptors.response.use.mock.calls[0];
			const successCallback = responseInterceptorCall[0];
			const errorCallback = responseInterceptorCall[1];

			// Test success callback
			const mockResponse = { data: "test" };
			expect(successCallback(mockResponse)).toBe(mockResponse);

			// Test error callback
			const mockError = new Error("Network error");
			await expect(errorCallback(mockError)).rejects.toThrow(
				"Certificate error",
			);
			expect(mockMaybeWrap).toHaveBeenCalledWith(
				mockError,
				"https://coder.example.com",
				mockStorage,
			);
		});
	});

	describe("createStreamingFetchAdapter", () => {
		it("should create fetch adapter that streams responses", async () => {
			const mockStream = {
				on: vi.fn(),
				destroy: vi.fn(),
			};

			const mockAxiosResponse = {
				data: mockStream,
				status: 200,
				headers: { "content-type": "application/json" },
				request: {
					res: {
						responseUrl: "https://example.com/api",
					},
				},
			};

			const mockAxiosInstance = {
				request: vi.fn().mockResolvedValue(mockAxiosResponse),
			};

			const adapter = createStreamingFetchAdapter(
				mockAxiosInstance as unknown as any,
			);

			// Mock ReadableStream
			global.ReadableStream = vi.fn().mockImplementation((options) => {
				const stream = {
					getReader: vi.fn(() => ({
						read: vi.fn(),
					})),
				};

				// Simulate stream operations
				if (options.start) {
					const controller = {
						enqueue: vi.fn(),
						close: vi.fn(),
						error: vi.fn(),
					};
					options.start(controller);
				}

				return stream;
			}) as any;

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

			expect(result).toEqual({
				body: {
					getReader: expect.any(Function),
				},
				url: "https://example.com/api",
				status: 200,
				redirected: false,
				headers: {
					get: expect.any(Function),
				},
			});

			// Test headers.get functionality
			expect(result.headers.get("content-type")).toBe("application/json");
			expect(result.headers.get("nonexistent")).toBe(null);
		});

		it("should handle URL objects", async () => {
			const mockAxiosInstance = {
				request: vi.fn().mockResolvedValue({
					data: { on: vi.fn(), destroy: vi.fn() },
					status: 200,
					headers: {},
					request: { res: { responseUrl: "https://example.com/api" } },
				}),
			};

			const adapter = createStreamingFetchAdapter(
				mockAxiosInstance as unknown as any,
			);

			await adapter(new URL("https://example.com/api"));

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					url: "https://example.com/api",
				}),
			);
		});
	});

	describe("startWorkspaceIfStoppedOrFailed", () => {
		it("should return workspace if already running", async () => {
			const mockWorkspace = {
				id: "workspace-1",
				owner_name: "user",
				name: "workspace",
				latest_build: { status: "running" },
			};

			const mockRestClient = {
				getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
			};

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			const result = await startWorkspaceIfStoppedOrFailed(
				mockRestClient as any,
				"/config",
				"/bin/coder",
				mockWorkspace as any,
				mockWriteEmitter,
			);

			expect(result).toBe(mockWorkspace);
			expect(mockRestClient.getWorkspace).toHaveBeenCalledWith("workspace-1");
		});

		it("should start workspace if stopped", async () => {
			const stoppedWorkspace = {
				id: "workspace-1",
				owner_name: "user",
				name: "workspace",
				latest_build: { status: "stopped" },
			};

			const runningWorkspace = {
				...stoppedWorkspace,
				latest_build: { status: "running" },
			};

			const mockRestClient = {
				getWorkspace: vi
					.fn()
					.mockResolvedValueOnce(stoppedWorkspace)
					.mockResolvedValueOnce(runningWorkspace),
			};

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			// Mock child_process.spawn
			const mockProcess = new EventEmitter() as any;
			mockProcess.stdout = new EventEmitter();
			mockProcess.stderr = new EventEmitter();
			vi.mocked(spawn).mockReturnValue(mockProcess);

			// Mock getHeaderArgs
			vi.mocked(getHeaderArgs).mockReturnValue(["--header", "key=value"]);

			// Start the async operation
			const resultPromise = startWorkspaceIfStoppedOrFailed(
				mockRestClient as any,
				"/config",
				"/bin/coder",
				stoppedWorkspace as any,
				mockWriteEmitter,
			);

			// Simulate process completion
			setTimeout(() => {
				mockProcess.emit("close", 0);
			}, 10);

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
			const stoppedWorkspace = {
				id: "workspace-1",
				owner_name: "user",
				name: "workspace",
				latest_build: { status: "failed" },
			};

			const mockRestClient = {
				getWorkspace: vi.fn().mockResolvedValue(stoppedWorkspace),
			};

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			// Mock child_process.spawn
			const mockProcess = new EventEmitter() as any;
			mockProcess.stdout = new EventEmitter();
			mockProcess.stderr = new EventEmitter();
			vi.mocked(spawn).mockReturnValue(mockProcess);

			// Mock getHeaderArgs
			vi.mocked(getHeaderArgs).mockReturnValue([]);

			// Start the async operation
			const resultPromise = startWorkspaceIfStoppedOrFailed(
				mockRestClient as any,
				"/config",
				"/bin/coder",
				stoppedWorkspace as any,
				mockWriteEmitter,
			);

			// Simulate process failure
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
		it("should wait for build completion and return updated workspace", async () => {
			const mockWorkspace = {
				id: "workspace-1",
				latest_build: { id: "build-1", status: "running" },
			};

			const mockLogs = [
				{ id: 1, output: "Starting build..." },
				{ id: 2, output: "Build in progress..." },
			];

			const mockRestClient = {
				getWorkspaceBuildLogs: vi.fn().mockResolvedValue(mockLogs),
				getWorkspace: vi.fn().mockResolvedValue({
					...mockWorkspace,
					latest_build: { ...mockWorkspace.latest_build, status: "running" },
				}),
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://coder.example.com",
						headers: {
							common: {
								[coderSessionTokenHeader]: "test-token",
							},
						},
					},
				})),
			};

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			// Mock WebSocket
			const mockSocket = new EventEmitter() as any;
			mockSocket.binaryType = "nodebuffer";
			vi.mocked(WebSocket).mockImplementation(() => mockSocket);

			// Start the async operation
			const resultPromise = waitForBuild(
				mockRestClient as any,
				mockWriteEmitter,
				mockWorkspace as any,
			);

			// Simulate WebSocket events
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
			expect(vi.mocked(WebSocket)).toHaveBeenCalledWith(
				expect.any(URL),
				expect.objectContaining({
					headers: {
						[coderSessionTokenHeader]: "test-token",
					},
				}),
			);
		});

		it("should handle WebSocket errors", async () => {
			const mockWorkspace = {
				id: "workspace-1",
				latest_build: { id: "build-1" },
			};

			const mockRestClient = {
				getWorkspaceBuildLogs: vi.fn().mockResolvedValue([]),
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://coder.example.com",
						headers: { common: {} },
					},
				})),
			};

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			// Mock WebSocket
			const mockSocket = new EventEmitter() as any;
			mockSocket.binaryType = "nodebuffer";
			vi.mocked(WebSocket).mockImplementation(() => mockSocket);

			// Mock errToStr
			vi.mocked(errToStr).mockReturnValue("connection failed");

			// Start the async operation
			const resultPromise = waitForBuild(
				mockRestClient as any,
				mockWriteEmitter,
				mockWorkspace as any,
			);

			// Simulate WebSocket error
			setTimeout(() => {
				mockSocket.emit("error", new Error("Connection failed"));
			}, 10);

			await expect(resultPromise).rejects.toThrow(
				"Failed to watch workspace build using wss://coder.example.com/api/v2/workspacebuilds/build-1/logs?follow=true: connection failed",
			);
		});

		it("should handle missing base URL", async () => {
			const mockWorkspace = {
				latest_build: { id: "build-1" },
			};

			const mockRestClient = {
				getAxiosInstance: vi.fn(() => ({
					defaults: {},
				})),
			};

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			await expect(
				waitForBuild(
					mockRestClient as any,
					mockWriteEmitter,
					mockWorkspace as any,
				),
			).rejects.toThrow("No base URL set on REST client");
		});

		it("should handle malformed URL errors in try-catch", async () => {
			const mockWorkspace = {
				id: "workspace-1",
				latest_build: { id: "build-1" },
			};

			const mockRestClient = {
				getWorkspaceBuildLogs: vi.fn().mockResolvedValue([]),
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "invalid-url://this-will-fail",
						headers: { common: {} },
					},
				})),
			};

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			// Mock WebSocket constructor to throw an error (simulating malformed URL)
			vi.mocked(WebSocket).mockImplementation(() => {
				throw new Error("Invalid URL");
			});

			// Mock errToStr
			vi.mocked(errToStr).mockReturnValue("malformed URL");

			await expect(
				waitForBuild(
					mockRestClient as any,
					mockWriteEmitter,
					mockWorkspace as any,
				),
			).rejects.toThrow(
				"Failed to watch workspace build on invalid-url://this-will-fail: malformed URL",
			);
		});

		it("should handle logs with after parameter", async () => {
			const mockWorkspace = {
				id: "workspace-1",
				latest_build: { id: "build-1", status: "running" },
			};

			const mockLogs = [
				{ id: 10, output: "Starting build..." },
				{ id: 20, output: "Build in progress..." },
			];

			const mockRestClient = {
				getWorkspaceBuildLogs: vi.fn().mockResolvedValue(mockLogs),
				getWorkspace: vi.fn().mockResolvedValue({
					...mockWorkspace,
					latest_build: { ...mockWorkspace.latest_build, status: "running" },
				}),
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://coder.example.com",
						headers: {
							common: {},
						},
					},
				})),
			};

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			// Mock WebSocket
			const mockSocket = new EventEmitter() as any;
			mockSocket.binaryType = "nodebuffer";
			vi.mocked(WebSocket).mockImplementation(() => mockSocket);

			// Start the async operation
			const resultPromise = waitForBuild(
				mockRestClient as any,
				mockWriteEmitter,
				mockWorkspace as any,
			);

			// Simulate WebSocket events
			setTimeout(() => {
				mockSocket.emit("close");
			}, 10);

			await resultPromise;

			// Verify WebSocket was created with after parameter from last log
			const websocketCalls = vi.mocked(WebSocket).mock.calls;
			expect(websocketCalls).toHaveLength(1);
			expect(websocketCalls[0][0]).toBeInstanceOf(URL);
			expect((websocketCalls[0][0] as URL).href).toBe(
				"wss://coder.example.com/api/v2/workspacebuilds/build-1/logs?follow=true&after=20",
			);
			expect(websocketCalls[0][1]).toMatchObject({
				followRedirects: true,
				headers: undefined,
			});
			expect(websocketCalls[0][1]).toHaveProperty("agent");
		});

		it("should handle WebSocket without auth token", async () => {
			const mockWorkspace = {
				id: "workspace-1",
				latest_build: { id: "build-1", status: "running" },
			};

			const mockRestClient = {
				getWorkspaceBuildLogs: vi.fn().mockResolvedValue([]),
				getWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
				getAxiosInstance: vi.fn(() => ({
					defaults: {
						baseURL: "https://coder.example.com",
						headers: {
							common: {}, // No token
						},
					},
				})),
			};

			const mockWriteEmitter = new vscode.EventEmitter<string>();

			// Mock WebSocket
			const mockSocket = new EventEmitter() as any;
			mockSocket.binaryType = "nodebuffer";
			vi.mocked(WebSocket).mockImplementation(() => mockSocket);

			// Start the async operation
			const resultPromise = waitForBuild(
				mockRestClient as any,
				mockWriteEmitter,
				mockWorkspace as any,
			);

			// Simulate WebSocket events
			setTimeout(() => {
				mockSocket.emit("close");
			}, 10);

			await resultPromise;

			// Verify WebSocket was created without auth headers
			const websocketCalls = vi.mocked(WebSocket).mock.calls;
			expect(websocketCalls).toHaveLength(1);
			expect(websocketCalls[0][0]).toBeInstanceOf(URL);
			expect((websocketCalls[0][0] as URL).href).toBe(
				"wss://coder.example.com/api/v2/workspacebuilds/build-1/logs?follow=true",
			);
			expect(websocketCalls[0][1]).toMatchObject({
				followRedirects: true,
				headers: undefined,
			});
			expect(websocketCalls[0][1]).toHaveProperty("agent");
		});
	});
});
