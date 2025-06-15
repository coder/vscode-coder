import { AxiosInstance } from "axios";
import { spawn } from "child_process";
import { Api } from "coder/site/src/api/api";
import {
	Workspace,
	ProvisionerJobLog,
} from "coder/site/src/api/typesGenerated";
import fs from "fs/promises";
import { ProxyAgent } from "proxy-agent";
import { describe, it, expect, vi, beforeEach, MockedFunction } from "vitest";
import * as vscode from "vscode";
import * as ws from "ws";
import {
	needToken,
	createHttpAgent,
	startWorkspaceIfStoppedOrFailed,
	makeCoderSdk,
	createStreamingFetchAdapter,
	setupStreamHandlers,
	waitForBuild,
} from "./api";
import { CertificateError } from "./error";
import * as headersModule from "./headers";
import * as proxyModule from "./proxy";
import { Storage } from "./storage";

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
	EventEmitter: vi.fn().mockImplementation(() => ({
		fire: vi.fn(),
	})),
}));

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
	},
}));

vi.mock("proxy-agent", () => ({
	ProxyAgent: vi.fn(),
}));

vi.mock("./proxy", () => ({
	getProxyForUrl: vi.fn(),
}));

vi.mock("./headers", () => ({
	getHeaderArgs: vi.fn().mockReturnValue([]),
}));

vi.mock("child_process", () => ({
	spawn: vi.fn(),
}));

vi.mock("./util", () => ({
	expandPath: vi.fn((path: string) =>
		path.replace("${userHome}", "/home/user"),
	),
}));

vi.mock("ws", () => ({
	WebSocket: vi.fn(),
}));

vi.mock("./storage", () => ({
	Storage: vi.fn(),
}));

vi.mock("./error", () => ({
	CertificateError: {
		maybeWrap: vi.fn((err) => Promise.resolve(err)),
	},
}));

vi.mock("coder/site/src/api/api", () => ({
	Api: vi.fn(),
}));

describe("needToken", () => {
	let mockGet: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockGet = vi.fn();
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: mockGet,
		} as unknown as vscode.WorkspaceConfiguration);
	});

	it("should return true when no TLS files are configured", () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.tlsCertFile") {
				return "";
			}
			if (key === "coder.tlsKeyFile") {
				return "";
			}
			return undefined;
		});

		expect(needToken()).toBe(true);
	});

	it("should return true when TLS config values are null", () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.tlsCertFile") {
				return null;
			}
			if (key === "coder.tlsKeyFile") {
				return null;
			}
			return undefined;
		});

		expect(needToken()).toBe(true);
	});

	it("should return true when TLS config values are undefined", () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.tlsCertFile") {
				return undefined;
			}
			if (key === "coder.tlsKeyFile") {
				return undefined;
			}
			return undefined;
		});

		expect(needToken()).toBe(true);
	});

	it("should return true when TLS config values are whitespace only", () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.tlsCertFile") {
				return "   ";
			}
			if (key === "coder.tlsKeyFile") {
				return "\t\n";
			}
			return undefined;
		});

		expect(needToken()).toBe(true);
	});

	it("should return false when only cert file is configured", () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.tlsCertFile") {
				return "/path/to/cert.pem";
			}
			if (key === "coder.tlsKeyFile") {
				return "";
			}
			return undefined;
		});

		expect(needToken()).toBe(false);
	});

	it("should return false when only key file is configured", () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.tlsCertFile") {
				return "";
			}
			if (key === "coder.tlsKeyFile") {
				return "/path/to/key.pem";
			}
			return undefined;
		});

		expect(needToken()).toBe(false);
	});

	it("should return false when both cert and key files are configured", () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.tlsCertFile") {
				return "/path/to/cert.pem";
			}
			if (key === "coder.tlsKeyFile") {
				return "/path/to/key.pem";
			}
			return undefined;
		});

		expect(needToken()).toBe(false);
	});

	it("should handle paths with ${userHome} placeholder", () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.tlsCertFile") {
				return "${userHome}/.coder/cert.pem";
			}
			if (key === "coder.tlsKeyFile") {
				return "";
			}
			return undefined;
		});

		expect(needToken()).toBe(false);
	});

	it("should handle mixed empty and configured values", () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.tlsCertFile") {
				return "   ";
			}
			if (key === "coder.tlsKeyFile") {
				return "/valid/path/key.pem";
			}
			return undefined;
		});

		expect(needToken()).toBe(false);
	});
});

describe("createHttpAgent", () => {
	let mockGet: ReturnType<typeof vi.fn>;
	let mockProxyAgentConstructor: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockGet = vi.fn();
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: mockGet,
		} as unknown as vscode.WorkspaceConfiguration);

		mockProxyAgentConstructor = vi.mocked(ProxyAgent);
		mockProxyAgentConstructor.mockImplementation((options) => {
			return { options } as unknown as ProxyAgent;
		});
	});

	it("should create agent with no TLS configuration", async () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.insecure") {
				return false;
			}
			if (key === "coder.tlsCertFile") {
				return "";
			}
			if (key === "coder.tlsKeyFile") {
				return "";
			}
			if (key === "coder.tlsCaFile") {
				return "";
			}
			if (key === "coder.tlsAltHost") {
				return "";
			}
			return undefined;
		});

		const _agent = await createHttpAgent();

		expect(mockProxyAgentConstructor).toHaveBeenCalledWith({
			getProxyForUrl: expect.any(Function),
			cert: undefined,
			key: undefined,
			ca: undefined,
			servername: undefined,
			rejectUnauthorized: true,
		});
		expect(vi.mocked(fs.readFile)).not.toHaveBeenCalled();
	});

	it("should create agent with insecure mode enabled", async () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.insecure") {
				return true;
			}
			if (key === "coder.tlsCertFile") {
				return "";
			}
			if (key === "coder.tlsKeyFile") {
				return "";
			}
			if (key === "coder.tlsCaFile") {
				return "";
			}
			if (key === "coder.tlsAltHost") {
				return "";
			}
			return undefined;
		});

		const _agent = await createHttpAgent();

		expect(mockProxyAgentConstructor).toHaveBeenCalledWith({
			getProxyForUrl: expect.any(Function),
			cert: undefined,
			key: undefined,
			ca: undefined,
			servername: undefined,
			rejectUnauthorized: false,
		});
	});

	it("should load certificate files when configured", async () => {
		const certContent = Buffer.from("cert-content");
		const keyContent = Buffer.from("key-content");
		const caContent = Buffer.from("ca-content");

		mockGet.mockImplementation((key: string) => {
			if (key === "coder.insecure") {
				return false;
			}
			if (key === "coder.tlsCertFile") {
				return "/path/to/cert.pem";
			}
			if (key === "coder.tlsKeyFile") {
				return "/path/to/key.pem";
			}
			if (key === "coder.tlsCaFile") {
				return "/path/to/ca.pem";
			}
			if (key === "coder.tlsAltHost") {
				return "";
			}
			return undefined;
		});

		vi.mocked(fs.readFile).mockImplementation((path: string) => {
			if (path === "/path/to/cert.pem") {
				return Promise.resolve(certContent);
			}
			if (path === "/path/to/key.pem") {
				return Promise.resolve(keyContent);
			}
			if (path === "/path/to/ca.pem") {
				return Promise.resolve(caContent);
			}
			return Promise.reject(new Error("Unknown file"));
		});

		const _agent = await createHttpAgent();

		expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith("/path/to/cert.pem");
		expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith("/path/to/key.pem");
		expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith("/path/to/ca.pem");

		expect(mockProxyAgentConstructor).toHaveBeenCalledWith({
			getProxyForUrl: expect.any(Function),
			cert: certContent,
			key: keyContent,
			ca: caContent,
			servername: undefined,
			rejectUnauthorized: true,
		});
	});

	it("should handle alternate hostname configuration", async () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.insecure") {
				return false;
			}
			if (key === "coder.tlsCertFile") {
				return "";
			}
			if (key === "coder.tlsKeyFile") {
				return "";
			}
			if (key === "coder.tlsCaFile") {
				return "";
			}
			if (key === "coder.tlsAltHost") {
				return "alternative.hostname.com";
			}
			return undefined;
		});

		const _agent = await createHttpAgent();

		expect(mockProxyAgentConstructor).toHaveBeenCalledWith({
			getProxyForUrl: expect.any(Function),
			cert: undefined,
			key: undefined,
			ca: undefined,
			servername: "alternative.hostname.com",
			rejectUnauthorized: true,
		});
	});

	it("should handle partial TLS configuration", async () => {
		const certContent = Buffer.from("cert-content");

		mockGet.mockImplementation((key: string) => {
			if (key === "coder.insecure") {
				return false;
			}
			if (key === "coder.tlsCertFile") {
				return "/path/to/cert.pem";
			}
			if (key === "coder.tlsKeyFile") {
				return "";
			}
			if (key === "coder.tlsCaFile") {
				return "";
			}
			if (key === "coder.tlsAltHost") {
				return "";
			}
			return undefined;
		});

		vi.mocked(fs.readFile).mockResolvedValue(certContent);

		const _agent = await createHttpAgent();

		expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith("/path/to/cert.pem");

		expect(mockProxyAgentConstructor).toHaveBeenCalledWith({
			getProxyForUrl: expect.any(Function),
			cert: certContent,
			key: undefined,
			ca: undefined,
			servername: undefined,
			rejectUnauthorized: true,
		});
	});

	it("should pass proxy configuration to getProxyForUrl", async () => {
		mockGet.mockImplementation((key: string) => {
			if (key === "coder.insecure") {
				return false;
			}
			if (key === "coder.tlsCertFile") {
				return "";
			}
			if (key === "coder.tlsKeyFile") {
				return "";
			}
			if (key === "coder.tlsCaFile") {
				return "";
			}
			if (key === "coder.tlsAltHost") {
				return "";
			}
			if (key === "http.proxy") {
				return "http://proxy.example.com:8080";
			}
			if (key === "coder.proxyBypass") {
				return "localhost,127.0.0.1";
			}
			return undefined;
		});

		vi.mocked(proxyModule.getProxyForUrl).mockReturnValue(
			"http://proxy.example.com:8080",
		);

		const agent = await createHttpAgent();
		const options = (
			agent as ProxyAgent & {
				options: { tls?: { cert?: string; key?: string } };
			}
		).options;

		// Test the getProxyForUrl function
		const proxyUrl = options.getProxyForUrl("https://example.com");

		expect(vi.mocked(proxyModule.getProxyForUrl)).toHaveBeenCalledWith(
			"https://example.com",
			"http://proxy.example.com:8080",
			"localhost,127.0.0.1",
		);
		expect(proxyUrl).toBe("http://proxy.example.com:8080");
	});

	it("should handle paths with ${userHome} in TLS files", async () => {
		const certContent = Buffer.from("cert-content");

		mockGet.mockImplementation((key: string) => {
			if (key === "coder.insecure") {
				return false;
			}
			if (key === "coder.tlsCertFile") {
				return "${userHome}/.coder/cert.pem";
			}
			if (key === "coder.tlsKeyFile") {
				return "";
			}
			if (key === "coder.tlsCaFile") {
				return "";
			}
			if (key === "coder.tlsAltHost") {
				return "";
			}
			return undefined;
		});

		vi.mocked(fs.readFile).mockResolvedValue(certContent);

		const _agent = await createHttpAgent();

		// The actual path will be expanded by expandPath
		expect(vi.mocked(fs.readFile)).toHaveBeenCalled();
		const calledPath = vi.mocked(fs.readFile).mock.calls[0][0];
		expect(calledPath).toMatch(/\/.*\/.coder\/cert.pem/);
		expect(calledPath).not.toContain("${userHome}");
	});
});

describe("startWorkspaceIfStoppedOrFailed", () => {
	let mockRestClient: Partial<Api>;
	let mockWorkspace: Workspace;
	let mockWriteEmitter: vscode.EventEmitter<string>;
	let mockSpawn: MockedFunction<typeof spawn>;
	let mockProcess: {
		stdout: {
			on: MockedFunction<
				(event: string, handler: (data: Buffer) => void) => void
			>;
		};
		stderr: {
			on: MockedFunction<
				(event: string, handler: (data: Buffer) => void) => void
			>;
		};
		on: MockedFunction<
			(event: string, handler: (code: number) => void) => void
		>;
		kill: MockedFunction<(signal?: string) => void>;
	};

	beforeEach(() => {
		vi.clearAllMocks();

		mockWorkspace = {
			id: "workspace-123",
			owner_name: "testuser",
			name: "testworkspace",
			latest_build: {
				status: "stopped",
			},
		} as Workspace;

		mockRestClient = {
			getWorkspace: vi.fn(),
		};

		mockWriteEmitter = new (vi.mocked(vscode.EventEmitter))();

		mockProcess = {
			stdout: { on: vi.fn() },
			stderr: { on: vi.fn() },
			on: vi.fn(),
		};

		mockSpawn = vi.mocked(spawn);
		mockSpawn.mockReturnValue(mockProcess as ReturnType<typeof spawn>);
	});

	it("should return workspace immediately if already running", async () => {
		const runningWorkspace = {
			...mockWorkspace,
			latest_build: { status: "running" },
		} as Workspace;

		vi.mocked(mockRestClient.getWorkspace).mockResolvedValue(runningWorkspace);

		const result = await startWorkspaceIfStoppedOrFailed(
			mockRestClient as Api,
			"/config/dir",
			"/bin/coder",
			mockWorkspace,
			mockWriteEmitter,
		);

		expect(result).toBe(runningWorkspace);
		expect(mockRestClient.getWorkspace).toHaveBeenCalledWith("workspace-123");
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("should start workspace when stopped", async () => {
		const stoppedWorkspace = {
			...mockWorkspace,
			latest_build: { status: "stopped" },
		} as Workspace;

		const startedWorkspace = {
			...mockWorkspace,
			latest_build: { status: "running" },
		} as Workspace;

		vi.mocked(mockRestClient.getWorkspace)
			.mockResolvedValueOnce(stoppedWorkspace)
			.mockResolvedValueOnce(startedWorkspace);

		vi.mocked(headersModule.getHeaderArgs).mockReturnValue([
			"--header",
			"Custom: Value",
		]);

		// Simulate successful process execution
		mockProcess.on.mockImplementation(
			(event: string, callback: (code: number) => void) => {
				if (event === "close") {
					setTimeout(() => callback(0), 10);
				}
			},
		);

		const result = await startWorkspaceIfStoppedOrFailed(
			mockRestClient as Api,
			"/config/dir",
			"/bin/coder",
			mockWorkspace,
			mockWriteEmitter,
		);

		expect(mockSpawn).toHaveBeenCalledWith("/bin/coder", [
			"--global-config",
			"/config/dir",
			"--header",
			"Custom: Value",
			"start",
			"--yes",
			"testuser/testworkspace",
		]);

		expect(result).toBe(startedWorkspace);
		expect(mockRestClient.getWorkspace).toHaveBeenCalledTimes(2);
	});

	it("should start workspace when failed", async () => {
		const failedWorkspace = {
			...mockWorkspace,
			latest_build: { status: "failed" },
		} as Workspace;

		const startedWorkspace = {
			...mockWorkspace,
			latest_build: { status: "running" },
		} as Workspace;

		vi.mocked(mockRestClient.getWorkspace)
			.mockResolvedValueOnce(failedWorkspace)
			.mockResolvedValueOnce(startedWorkspace);

		mockProcess.on.mockImplementation(
			(event: string, callback: (code: number) => void) => {
				if (event === "close") {
					setTimeout(() => callback(0), 10);
				}
			},
		);

		const result = await startWorkspaceIfStoppedOrFailed(
			mockRestClient as Api,
			"/config/dir",
			"/bin/coder",
			mockWorkspace,
			mockWriteEmitter,
		);

		expect(mockSpawn).toHaveBeenCalled();
		expect(result).toBe(startedWorkspace);
	});

	it("should handle stdout data and fire events", async () => {
		const stoppedWorkspace = {
			...mockWorkspace,
			latest_build: { status: "stopped" },
		} as Workspace;

		vi.mocked(mockRestClient.getWorkspace).mockResolvedValueOnce(
			stoppedWorkspace,
		);

		let stdoutCallback: (data: Buffer) => void;
		mockProcess.stdout.on.mockImplementation(
			(event: string, callback: (data: Buffer) => void) => {
				if (event === "data") {
					stdoutCallback = callback;
				}
			},
		);

		mockProcess.on.mockImplementation(
			(event: string, callback: (code: number) => void) => {
				if (event === "close") {
					setTimeout(() => {
						// Simulate stdout data before close
						stdoutCallback(
							Buffer.from("Starting workspace...\nWorkspace started!\n"),
						);
						callback(0);
					}, 10);
				}
			},
		);

		await startWorkspaceIfStoppedOrFailed(
			mockRestClient as Api,
			"/config/dir",
			"/bin/coder",
			mockWorkspace,
			mockWriteEmitter,
		);

		expect(mockWriteEmitter.fire).toHaveBeenCalledWith(
			"Starting workspace...\r\n",
		);
		expect(mockWriteEmitter.fire).toHaveBeenCalledWith(
			"Workspace started!\r\n",
		);
	});

	it("should handle stderr data and capture for error message", async () => {
		const stoppedWorkspace = {
			...mockWorkspace,
			latest_build: { status: "stopped" },
		} as Workspace;

		vi.mocked(mockRestClient.getWorkspace).mockResolvedValueOnce(
			stoppedWorkspace,
		);

		let stderrCallback: (data: Buffer) => void;
		mockProcess.stderr.on.mockImplementation(
			(event: string, callback: (data: Buffer) => void) => {
				if (event === "data") {
					stderrCallback = callback;
				}
			},
		);

		mockProcess.on.mockImplementation(
			(event: string, callback: (code: number) => void) => {
				if (event === "close") {
					setTimeout(() => {
						// Simulate stderr data before close
						stderrCallback(
							Buffer.from("Error: Failed to start\nPermission denied\n"),
						);
						callback(1); // Exit with error
					}, 10);
				}
			},
		);

		await expect(
			startWorkspaceIfStoppedOrFailed(
				mockRestClient as Api,
				"/config/dir",
				"/bin/coder",
				mockWorkspace,
				mockWriteEmitter,
			),
		).rejects.toThrow(
			"exited with code 1: Error: Failed to start\nPermission denied",
		);

		expect(mockWriteEmitter.fire).toHaveBeenCalledWith(
			"Error: Failed to start\r\n",
		);
		expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Permission denied\r\n");
	});

	it("should handle process failure without stderr", async () => {
		const stoppedWorkspace = {
			...mockWorkspace,
			latest_build: { status: "stopped" },
		} as Workspace;

		vi.mocked(mockRestClient.getWorkspace).mockResolvedValueOnce(
			stoppedWorkspace,
		);

		mockProcess.on.mockImplementation(
			(event: string, callback: (code: number) => void) => {
				if (event === "close") {
					setTimeout(() => callback(127), 10); // Command not found
				}
			},
		);

		await expect(
			startWorkspaceIfStoppedOrFailed(
				mockRestClient as Api,
				"/config/dir",
				"/bin/coder",
				mockWorkspace,
				mockWriteEmitter,
			),
		).rejects.toThrow("exited with code 127");
	});

	it("should handle empty lines in stdout/stderr", async () => {
		const stoppedWorkspace = {
			...mockWorkspace,
			latest_build: { status: "stopped" },
		} as Workspace;

		vi.mocked(mockRestClient.getWorkspace).mockResolvedValueOnce(
			stoppedWorkspace,
		);

		let stdoutCallback: (data: Buffer) => void;
		mockProcess.stdout.on.mockImplementation(
			(event: string, callback: (data: Buffer) => void) => {
				if (event === "data") {
					stdoutCallback = callback;
				}
			},
		);

		mockProcess.on.mockImplementation(
			(event: string, callback: (code: number) => void) => {
				if (event === "close") {
					setTimeout(() => {
						// Simulate data with empty lines
						stdoutCallback(Buffer.from("Line 1\n\nLine 2\n\n\n"));
						callback(0);
					}, 10);
				}
			},
		);

		await startWorkspaceIfStoppedOrFailed(
			mockRestClient as Api,
			"/config/dir",
			"/bin/coder",
			mockWorkspace,
			mockWriteEmitter,
		);

		// Empty lines should not fire events
		expect(mockWriteEmitter.fire).toHaveBeenCalledTimes(2);
		expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Line 1\r\n");
		expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Line 2\r\n");
	});
});

describe("makeCoderSdk", () => {
	let mockStorage: Storage;
	let mockGet: ReturnType<typeof vi.fn>;
	let mockAxiosInstance: AxiosInstance;
	let mockApi: Api;

	beforeEach(() => {
		vi.clearAllMocks();

		mockGet = vi.fn();
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: mockGet,
		} as unknown as vscode.WorkspaceConfiguration);

		mockStorage = {
			getHeaders: vi.fn().mockResolvedValue({}),
		} as unknown as Storage;

		mockAxiosInstance = {
			interceptors: {
				request: { use: vi.fn() },
				response: { use: vi.fn() },
			},
			defaults: {
				baseURL: "https://coder.example.com",
				headers: {
					common: {},
				},
			},
		};

		mockApi = {
			setHost: vi.fn(),
			setSessionToken: vi.fn(),
			getAxiosInstance: vi.fn().mockReturnValue(mockAxiosInstance),
		};

		// Mock the Api constructor
		vi.mocked(Api).mockImplementation(() => mockApi);
	});

	it("should create SDK with token authentication", async () => {
		const _sdk = await makeCoderSdk(
			"https://coder.example.com",
			"test-token",
			mockStorage,
		);

		expect(mockApi.setHost).toHaveBeenCalledWith("https://coder.example.com");
		expect(mockApi.setSessionToken).toHaveBeenCalledWith("test-token");
		expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
		expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
	});

	it("should create SDK without token (mTLS auth)", async () => {
		const _sdk = await makeCoderSdk(
			"https://coder.example.com",
			undefined,
			mockStorage,
		);

		expect(mockApi.setHost).toHaveBeenCalledWith("https://coder.example.com");
		expect(mockApi.setSessionToken).not.toHaveBeenCalled();
	});

	it("should configure request interceptor with headers from storage", async () => {
		const customHeaders = {
			"X-Custom-Header": "custom-value",
			Authorization: "Bearer special-token",
		};
		vi.mocked(mockStorage.getHeaders).mockResolvedValue(customHeaders);

		await makeCoderSdk("https://coder.example.com", "test-token", mockStorage);

		const requestInterceptor =
			mockAxiosInstance.interceptors.request.use.mock.calls[0][0];

		const config = {
			headers: {},
			httpsAgent: undefined,
			httpAgent: undefined,
			proxy: undefined,
		};

		const result = await requestInterceptor(config);

		expect(mockStorage.getHeaders).toHaveBeenCalledWith(
			"https://coder.example.com",
		);
		expect(result.headers).toEqual(customHeaders);
		expect(result.httpsAgent).toBeDefined();
		expect(result.httpAgent).toBeDefined();
		expect(result.proxy).toBe(false);
	});

	it("should configure response interceptor for certificate errors", async () => {
		const testError = new Error("Certificate error");
		const wrappedError = new Error("Wrapped certificate error");

		vi.mocked(CertificateError.maybeWrap).mockResolvedValue(wrappedError);

		await makeCoderSdk("https://coder.example.com", "test-token", mockStorage);

		const responseInterceptor =
			mockAxiosInstance.interceptors.response.use.mock.calls[0];
		const successHandler = responseInterceptor[0];
		const errorHandler = responseInterceptor[1];

		// Test success handler
		const response = { data: "test" };
		expect(successHandler(response)).toBe(response);

		// Test error handler
		await expect(errorHandler(testError)).rejects.toBe(wrappedError);
		expect(CertificateError.maybeWrap).toHaveBeenCalledWith(
			testError,
			"https://coder.example.com",
			mockStorage,
		);
	});
});

describe("setupStreamHandlers", () => {
	let mockStream: {
		on: MockedFunction<
			(event: string, handler: (...args: unknown[]) => void) => void
		>;
	};
	let mockController: AbortController;

	beforeEach(() => {
		vi.clearAllMocks();

		mockStream = {
			on: vi.fn(),
		};

		mockController = {
			enqueue: vi.fn(),
			close: vi.fn(),
			error: vi.fn(),
		};
	});

	it("should register handlers for data, end, and error events", () => {
		setupStreamHandlers(mockStream, mockController);

		expect(mockStream.on).toHaveBeenCalledTimes(3);
		expect(mockStream.on).toHaveBeenCalledWith("data", expect.any(Function));
		expect(mockStream.on).toHaveBeenCalledWith("end", expect.any(Function));
		expect(mockStream.on).toHaveBeenCalledWith("error", expect.any(Function));
	});

	it("should enqueue chunks when data event is emitted", () => {
		setupStreamHandlers(mockStream, mockController);

		const dataHandler = mockStream.on.mock.calls.find(
			(call: [string, ...unknown[]]) => call[0] === "data",
		)?.[1];

		const testChunk = Buffer.from("test data");
		dataHandler(testChunk);

		expect(mockController.enqueue).toHaveBeenCalledWith(testChunk);
	});

	it("should close controller when end event is emitted", () => {
		setupStreamHandlers(mockStream, mockController);

		const endHandler = mockStream.on.mock.calls.find(
			(call: [string, ...unknown[]]) => call[0] === "end",
		)?.[1];

		endHandler();

		expect(mockController.close).toHaveBeenCalled();
	});

	it("should error controller when error event is emitted", () => {
		setupStreamHandlers(mockStream, mockController);

		const errorHandler = mockStream.on.mock.calls.find(
			(call: [string, ...unknown[]]) => call[0] === "error",
		)?.[1];

		const testError = new Error("Stream error");
		errorHandler(testError);

		expect(mockController.error).toHaveBeenCalledWith(testError);
	});
});

describe("createStreamingFetchAdapter", () => {
	let mockAxiosInstance: AxiosInstance;
	let mockStream: {
		on: MockedFunction<
			(event: string, handler: (...args: unknown[]) => void) => void
		>;
	};

	beforeEach(() => {
		vi.clearAllMocks();

		mockStream = {
			on: vi.fn(),
			destroy: vi.fn(),
		};

		mockAxiosInstance = {
			request: vi.fn().mockResolvedValue({
				status: 200,
				headers: {
					"content-type": "application/json",
					"x-custom-header": "test-value",
				},
				data: mockStream,
				request: {
					res: {
						responseUrl: "https://example.com/api",
					},
				},
			}),
		};
	});

	it("should create a fetch-like response with streaming body", async () => {
		const fetchAdapter = createStreamingFetchAdapter(mockAxiosInstance);
		const response = await fetchAdapter("https://example.com/api");

		expect(mockAxiosInstance.request).toHaveBeenCalledWith({
			url: "https://example.com/api",
			signal: undefined,
			headers: undefined,
			responseType: "stream",
			validateStatus: expect.any(Function),
		});

		expect(response.status).toBe(200);
		expect(response.url).toBe("https://example.com/api");
		expect(response.redirected).toBe(false);
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.headers.get("x-custom-header")).toBe("test-value");
		expect(response.headers.get("non-existent")).toBeNull();
	});

	it("should handle URL objects", async () => {
		const fetchAdapter = createStreamingFetchAdapter(mockAxiosInstance);
		const url = new URL("https://example.com/api/v2");

		await fetchAdapter(url);

		expect(mockAxiosInstance.request).toHaveBeenCalledWith({
			url: "https://example.com/api/v2",
			signal: undefined,
			headers: undefined,
			responseType: "stream",
			validateStatus: expect.any(Function),
		});
	});

	it("should pass through init options", async () => {
		const fetchAdapter = createStreamingFetchAdapter(mockAxiosInstance);
		const signal = new AbortController().signal;
		const headers = { Authorization: "Bearer token" };

		await fetchAdapter("https://example.com/api", { signal, headers });

		expect(mockAxiosInstance.request).toHaveBeenCalledWith({
			url: "https://example.com/api",
			signal,
			headers,
			responseType: "stream",
			validateStatus: expect.any(Function),
		});
	});

	it("should handle redirected responses", async () => {
		mockAxiosInstance.request.mockResolvedValue({
			status: 302,
			headers: {},
			data: mockStream,
			request: {
				res: {
					responseUrl: "https://example.com/redirected",
				},
			},
		});

		const fetchAdapter = createStreamingFetchAdapter(mockAxiosInstance);
		const response = await fetchAdapter("https://example.com/api");

		expect(response.redirected).toBe(true);
	});

	it("should stream data through ReadableStream", async () => {
		const fetchAdapter = createStreamingFetchAdapter(mockAxiosInstance);
		const response = await fetchAdapter("https://example.com/api");

		// Test that getReader returns a reader
		const reader = response.body.getReader();
		expect(reader).toBeDefined();
	});

	it("should handle stream cancellation", async () => {
		let streamController: ReadableStreamDefaultController<Uint8Array>;
		const mockReadableStream = vi
			.fn()
			.mockImplementation(({ start, cancel }) => {
				streamController = { start, cancel };
				return {
					getReader: () => ({ read: vi.fn() }),
				};
			});

		// Replace global ReadableStream temporarily
		const originalReadableStream = global.ReadableStream;
		global.ReadableStream = mockReadableStream as typeof ReadableStream;

		try {
			const fetchAdapter = createStreamingFetchAdapter(mockAxiosInstance);
			await fetchAdapter("https://example.com/api");

			// Call the cancel function
			await streamController.cancel();

			expect(mockStream.destroy).toHaveBeenCalled();
		} finally {
			global.ReadableStream = originalReadableStream;
		}
	});

	it("should validate all status codes", async () => {
		const fetchAdapter = createStreamingFetchAdapter(mockAxiosInstance);
		await fetchAdapter("https://example.com/api");

		const validateStatus =
			mockAxiosInstance.request.mock.calls[0][0].validateStatus;

		// Should return true for any status code
		expect(validateStatus(200)).toBe(true);
		expect(validateStatus(404)).toBe(true);
		expect(validateStatus(500)).toBe(true);
	});
});

describe("waitForBuild", () => {
	let mockRestClient: Partial<Api>;
	let mockWorkspace: Workspace;
	let mockWriteEmitter: vscode.EventEmitter<string>;
	let mockWebSocket: ws.WebSocket;
	let mockAxiosInstance: AxiosInstance;

	beforeEach(() => {
		vi.clearAllMocks();

		mockWorkspace = {
			id: "workspace-123",
			owner_name: "testuser",
			name: "testworkspace",
			latest_build: {
				id: "build-456",
				status: "running",
			},
		} as Workspace;

		mockAxiosInstance = {
			defaults: {
				baseURL: "https://coder.example.com",
				headers: {
					common: {
						"Coder-Session-Token": "test-token",
					},
				},
			},
		};

		mockRestClient = {
			getWorkspace: vi.fn(),
			getWorkspaceBuildLogs: vi.fn(),
			getAxiosInstance: vi.fn().mockReturnValue(mockAxiosInstance),
		};

		mockWriteEmitter = new (vi.mocked(vscode.EventEmitter))();

		mockWebSocket = {
			on: vi.fn(),
			binaryType: undefined,
		};

		vi.mocked(ws.WebSocket).mockImplementation(() => mockWebSocket);
	});

	it("should fetch initial logs and stream follow logs", async () => {
		const initialLogs: ProvisionerJobLog[] = [
			{ id: 1, output: "Initial log 1", created_at: new Date().toISOString() },
			{ id: 2, output: "Initial log 2", created_at: new Date().toISOString() },
		];

		const updatedWorkspace = {
			...mockWorkspace,
			latest_build: { status: "running" },
		} as Workspace;

		vi.mocked(mockRestClient.getWorkspaceBuildLogs).mockResolvedValue(
			initialLogs,
		);
		vi.mocked(mockRestClient.getWorkspace).mockResolvedValue(updatedWorkspace);

		// Simulate websocket close event
		mockWebSocket.on.mockImplementation(
			(event: string, callback: (...args: unknown[]) => void) => {
				if (event === "close") {
					setTimeout(() => callback(), 10);
				}
			},
		);

		const result = await waitForBuild(
			mockRestClient as Api,
			mockWriteEmitter,
			mockWorkspace,
		);

		// Verify initial logs were fetched
		expect(mockRestClient.getWorkspaceBuildLogs).toHaveBeenCalledWith(
			"build-456",
		);
		expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Initial log 1\r\n");
		expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Initial log 2\r\n");

		// Verify WebSocket was created with correct URL (https -> wss)
		expect(ws.WebSocket).toHaveBeenCalledWith(
			new URL(
				"wss://coder.example.com/api/v2/workspacebuilds/build-456/logs?follow=true&after=2",
			),
			{
				agent: expect.any(Object),
				followRedirects: true,
				headers: {
					"Coder-Session-Token": "test-token",
				},
			},
		);

		// Verify final messages
		expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Build complete\r\n");
		expect(mockWriteEmitter.fire).toHaveBeenCalledWith(
			"Workspace is now running\r\n",
		);

		expect(result).toBe(updatedWorkspace);
	});

	it("should handle HTTPS URLs for WebSocket", async () => {
		mockAxiosInstance.defaults.baseURL = "https://secure.coder.com";

		vi.mocked(mockRestClient.getWorkspaceBuildLogs).mockResolvedValue([]);
		vi.mocked(mockRestClient.getWorkspace).mockResolvedValue(mockWorkspace);

		mockWebSocket.on.mockImplementation(
			(event: string, callback: (...args: unknown[]) => void) => {
				if (event === "close") {
					setTimeout(() => callback(), 10);
				}
			},
		);

		await waitForBuild(mockRestClient as Api, mockWriteEmitter, mockWorkspace);

		expect(ws.WebSocket).toHaveBeenCalledWith(
			new URL(
				"wss://secure.coder.com/api/v2/workspacebuilds/build-456/logs?follow=true",
			),
			expect.any(Object),
		);
	});

	it("should handle WebSocket messages", async () => {
		vi.mocked(mockRestClient.getWorkspaceBuildLogs).mockResolvedValue([]);
		vi.mocked(mockRestClient.getWorkspace).mockResolvedValue(mockWorkspace);

		const followLogs: ProvisionerJobLog[] = [
			{ id: 3, output: "Follow log 1", created_at: new Date().toISOString() },
			{ id: 4, output: "Follow log 2", created_at: new Date().toISOString() },
		];

		let messageHandler: (data: unknown) => void;
		mockWebSocket.on.mockImplementation(
			(event: string, callback: (...args: unknown[]) => void) => {
				if (event === "message") {
					messageHandler = callback;
				} else if (event === "close") {
					setTimeout(() => {
						// Simulate receiving messages before close
						followLogs.forEach((log) => {
							messageHandler(Buffer.from(JSON.stringify(log)));
						});
						callback();
					}, 10);
				}
			},
		);

		await waitForBuild(mockRestClient as Api, mockWriteEmitter, mockWorkspace);

		expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Follow log 1\r\n");
		expect(mockWriteEmitter.fire).toHaveBeenCalledWith("Follow log 2\r\n");
		expect(mockWebSocket.binaryType).toBe("nodebuffer");
	});

	it("should handle WebSocket errors", async () => {
		vi.mocked(mockRestClient.getWorkspaceBuildLogs).mockResolvedValue([]);

		let errorHandler: (error: Error) => void;
		mockWebSocket.on.mockImplementation(
			(event: string, callback: (...args: unknown[]) => void) => {
				if (event === "error") {
					errorHandler = callback;
					setTimeout(
						() => errorHandler(new Error("WebSocket connection failed")),
						10,
					);
				}
			},
		);

		await expect(
			waitForBuild(mockRestClient as Api, mockWriteEmitter, mockWorkspace),
		).rejects.toThrow(
			"Failed to watch workspace build using wss://coder.example.com/api/v2/workspacebuilds/build-456/logs?follow=true: WebSocket connection failed",
		);
	});

	it("should handle missing baseURL", async () => {
		mockAxiosInstance.defaults.baseURL = undefined;

		await expect(
			waitForBuild(mockRestClient as Api, mockWriteEmitter, mockWorkspace),
		).rejects.toThrow("No base URL set on REST client");
	});

	it("should handle URL construction errors", async () => {
		mockAxiosInstance.defaults.baseURL = "not-a-valid-url";

		vi.mocked(mockRestClient.getWorkspaceBuildLogs).mockResolvedValue([]);

		await expect(
			waitForBuild(mockRestClient as Api, mockWriteEmitter, mockWorkspace),
		).rejects.toThrow(/Failed to watch workspace build on not-a-valid-url/);
	});

	it("should not include token header when token is undefined", async () => {
		mockAxiosInstance.defaults.headers.common["Coder-Session-Token"] =
			undefined;

		vi.mocked(mockRestClient.getWorkspaceBuildLogs).mockResolvedValue([]);
		vi.mocked(mockRestClient.getWorkspace).mockResolvedValue(mockWorkspace);

		mockWebSocket.on.mockImplementation(
			(event: string, callback: (...args: unknown[]) => void) => {
				if (event === "close") {
					setTimeout(() => callback(), 10);
				}
			},
		);

		await waitForBuild(mockRestClient as Api, mockWriteEmitter, mockWorkspace);

		expect(ws.WebSocket).toHaveBeenCalledWith(
			new URL(
				"wss://coder.example.com/api/v2/workspacebuilds/build-456/logs?follow=true",
			),
			{
				agent: expect.any(Object),
				followRedirects: true,
				headers: undefined,
			},
		);
	});

	it("should handle empty initial logs", async () => {
		vi.mocked(mockRestClient.getWorkspaceBuildLogs).mockResolvedValue([]);
		vi.mocked(mockRestClient.getWorkspace).mockResolvedValue(mockWorkspace);

		mockWebSocket.on.mockImplementation(
			(event: string, callback: (...args: unknown[]) => void) => {
				if (event === "close") {
					setTimeout(() => callback(), 10);
				}
			},
		);

		await waitForBuild(mockRestClient as Api, mockWriteEmitter, mockWorkspace);

		// Should not include after parameter when no initial logs
		expect(ws.WebSocket).toHaveBeenCalledWith(
			new URL(
				"wss://coder.example.com/api/v2/workspacebuilds/build-456/logs?follow=true",
			),
			expect.any(Object),
		);
	});
});
