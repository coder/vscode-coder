import globalAxios, { AxiosInstance } from "axios";
import { Api } from "coder/site/src/api/api";
import { BuildInfoResponse } from "coder/site/src/api/typesGenerated";
import type { Stats, WriteStream } from "fs";
import * as fs from "fs";
import * as fse from "fs/promises";
import { IncomingMessage } from "http";
import * as path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceConfiguration } from "vscode";
import * as cli from "../cliManager";
import { Logger } from "../logging/logger";
import * as pgp from "../pgp";
import { BinaryManager } from "./binaryManager";
import {
	ConfigurationProvider,
	ProgressReporter,
	UserInteraction,
} from "./binaryManager.interfaces";
import { PathResolver } from "./pathResolver";

// Mock all external modules
vi.mock("fs/promises");
vi.mock("fs", () => ({
	createWriteStream: vi.fn(),
}));
vi.mock("../cliManager");
vi.mock("../pgp");
vi.mock("axios");

describe("Binary Manager", () => {
	let manager: BinaryManager;
	let mockLogger: Logger;
	let mockConfig: MockConfigurationProvider;
	let mockProgress: MockProgressReporter;
	let mockUI: MockUserInteraction;
	let mockApi: Api;
	let mockAxios: AxiosInstance;

	// Test constants
	const TEST_VERSION = "1.2.3";
	const TEST_URL = "https://test.coder.com";
	const BINARY_PATH = "/path/binary/coder";

	beforeEach(() => {
		vi.clearAllMocks();

		// Initialize all mocks
		mockLogger = createMockLogger();
		mockConfig = new MockConfigurationProvider();
		mockProgress = new MockProgressReporter();
		mockUI = new MockUserInteraction();
		mockApi = createMockApi(TEST_VERSION, TEST_URL);
		mockAxios = mockApi.getAxiosInstance();

		vi.mocked(globalAxios.create).mockReturnValue(mockAxios);

		const config = {
			get: (key: string) =>
				key === "coder.binaryDestination"
					? path.dirname(BINARY_PATH)
					: undefined,
		} as unknown as WorkspaceConfiguration;
		const pathResolver = new PathResolver("/path/base", "/code/log", config);

		manager = new BinaryManager(
			mockLogger,
			pathResolver,
			mockConfig,
			mockProgress,
			mockUI,
		);

		// Setup default CLI mocks
		setupDefaultCliMocks();
	});

	describe("Configuration", () => {
		it("respects disabled downloads setting", async () => {
			mockConfig.set("coder.enableDownloads", false);

			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Unable to download CLI because downloads are disabled",
			);
		});

		it("validates server version", async () => {
			mockApi.getBuildInfo = vi.fn().mockResolvedValue({
				version: "invalid-version",
			});

			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Got invalid version from deployment",
			);
		});

		it("uses existing binary when versions match", async () => {
			setupExistingBinary(TEST_VERSION);

			const result = await manager.fetchBinary(mockApi, "test");

			expect(result).toBe(BINARY_PATH);
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Using existing binary since it matches the server version",
			);
		});

		it("handles corrupted existing binary gracefully", async () => {
			vi.mocked(cli.stat).mockResolvedValue({ size: 1024 } as Stats);
			vi.mocked(cli.version).mockRejectedValueOnce(new Error("corrupted"));

			setupSuccessfulDownload(mockApi);

			const result = await manager.fetchBinary(mockApi, "test");

			expect(result).toBe(BINARY_PATH);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Unable to get version of existing binary"),
			);
		});
	});

	describe("Download Flow", () => {
		it("downloads binary successfully", async () => {
			setupSuccessfulDownload(mockApi);

			const result = await manager.fetchBinary(mockApi, "test");

			expect(result).toBe(BINARY_PATH);
			expect(mockAxios.get).toHaveBeenCalledWith(
				"/bin/coder",
				expect.objectContaining({
					responseType: "stream",
					headers: expect.objectContaining({
						"Accept-Encoding": "gzip",
					}),
				}),
			);
		});

		it("handles 304 Not Modified response", async () => {
			setupExistingBinary("1.2.5"); // Different version
			mockAxios.get = vi.fn().mockResolvedValue({
				status: 304,
				headers: {},
				data: undefined,
			});

			const result = await manager.fetchBinary(mockApi, "test");

			expect(result).toBe(BINARY_PATH);
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Using existing binary since server returned a 304",
			);
		});

		it("handles 404 platform not supported", async () => {
			mockAxios.get = vi.fn().mockResolvedValue({
				status: 404,
				headers: {},
				data: undefined,
			});
			mockUI.setResponse("Open an Issue");

			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Platform not supported",
			);

			expect(mockUI.openExternal).toHaveBeenCalledWith(
				expect.stringContaining("github.com/coder/vscode-coder/issues/new"),
			);
		});

		it("handles download failure", async () => {
			mockAxios.get = vi.fn().mockResolvedValue({
				status: 500,
				headers: {},
				data: undefined,
			});

			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Failed to download binary",
			);
		});
	});

	describe("Stream Error Handling", () => {
		it("handles write stream errors", async () => {
			const writeError = new Error("disk full");
			const { mockWriteStream, mockReadStream } = setupStreamMocks();

			// Trigger write error after setup
			mockWriteStream.on = vi.fn((event, callback) => {
				if (event === "error") {
					setTimeout(() => callback(writeError), 5);
				}
				return mockWriteStream;
			});

			mockAxios.get = vi.fn().mockResolvedValue({
				status: 200,
				headers: { "content-length": "1024" },
				data: mockReadStream,
			});

			vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);

			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Unable to download binary: disk full",
			);

			expect(mockReadStream.destroy).toHaveBeenCalled();
		});

		it("handles read stream errors", async () => {
			const { mockWriteStream } = setupStreamMocks();
			const mockReadStream = createMockReadStream((event, callback) => {
				if (event === "error") {
					setTimeout(() => callback(new Error("network timeout")), 5);
				}
			});

			mockAxios.get = vi.fn().mockResolvedValue({
				status: 200,
				headers: { "content-length": "1024" },
				data: mockReadStream,
			});

			vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);

			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Unable to download binary: network timeout",
			);

			expect(mockWriteStream.close).toHaveBeenCalled();
		});
	});

	describe("Progress Monitor", () => {
		it("rejects with 'Download aborted' when cancelled", async () => {
			const { mockWriteStream, mockReadStream } = setupStreamMocks();

			// Enable cancellation for this test
			mockProgress.setCancellation(true);

			mockAxios.get = vi.fn().mockResolvedValue({
				status: 200,
				headers: { "content-length": "1024" },
				data: mockReadStream,
			});

			vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);

			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Download aborted",
			);

			expect(mockReadStream.destroy).toHaveBeenCalled();

			// Reset cancellation state
			mockProgress.setCancellation(false);
		});
	});

	describe("Signature Verification", () => {
		beforeEach(() => {
			vi.mocked(pgp.readPublicKeys).mockResolvedValue([]);
		});

		it("verifies signature successfully", async () => {
			vi.mocked(pgp.verifySignature).mockResolvedValue();
			setupSuccessfulDownloadWithSignature(mockApi);

			const result = await manager.fetchBinary(mockApi, "test");

			expect(result).toBe(BINARY_PATH);
			expect(pgp.verifySignature).toHaveBeenCalled();
		});

		it("tries alternative signature source on 404", async () => {
			vi.mocked(pgp.verifySignature).mockResolvedValue();

			const { mockWriteStream, mockReadStream } = setupStreamMocks();
			mockAxios.get = vi
				.fn()
				.mockResolvedValueOnce(createStreamResponse(200, mockReadStream)) // Binary
				.mockResolvedValueOnce({ status: 404, headers: {}, data: undefined }) // First sig
				.mockResolvedValueOnce(createStreamResponse(200, mockReadStream)); // Alt sig

			vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);
			vi.mocked(cli.stat)
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({ size: 1024 } as Stats);

			mockUI.setResponse("Download signature");

			const result = await manager.fetchBinary(mockApi, "test");

			expect(result).toBe(BINARY_PATH);
			expect(mockUI.showWarningMessage).toHaveBeenCalledWith(
				"Signature not found",
				expect.any(Object),
				expect.any(String),
				expect.any(String),
			);
		});

		it("allows running without verification on user request", async () => {
			setupSuccessfulDownload(mockApi);
			mockAxios.get = vi
				.fn()
				.mockResolvedValueOnce(
					createStreamResponse(200, createMockReadStream()),
				)
				.mockResolvedValueOnce({ status: 404, headers: {}, data: undefined });

			mockUI.setResponse("Run without verification");

			const result = await manager.fetchBinary(mockApi, "test");

			expect(result).toBe(BINARY_PATH);
			expect(pgp.verifySignature).not.toHaveBeenCalled();
		});

		it("handles invalid signature with user override", async () => {
			const verificationError = new pgp.VerificationError(
				pgp.VerificationErrorCode.Invalid,
				"Invalid signature",
			);
			verificationError.summary = () => "Signature does not match";
			vi.mocked(pgp.verifySignature).mockRejectedValue(verificationError);

			setupSuccessfulDownloadWithSignature(mockApi);
			mockUI.setResponse("Run anyway");

			const result = await manager.fetchBinary(mockApi, "test");

			expect(result).toBe(BINARY_PATH);
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Binary will be ran anyway at user request",
			);
		});

		it("aborts on signature verification rejection", async () => {
			const verificationError = new pgp.VerificationError(
				pgp.VerificationErrorCode.Invalid,
				"Invalid signature",
			);
			verificationError.summary = () => "Signature does not match";
			vi.mocked(pgp.verifySignature).mockRejectedValue(verificationError);

			setupSuccessfulDownloadWithSignature(mockApi);
			mockUI.setResponse(undefined); // User rejects

			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Signature verification aborted",
			);
		});

		it("skips verification when disabled in config", async () => {
			mockConfig.set("coder.disableSignatureVerification", true);
			vi.mocked(cli.version).mockResolvedValueOnce("1.5.9"); // No existing binary
			setupSuccessfulDownload(mockApi);

			const result = await manager.fetchBinary(mockApi, "test");

			expect(result).toBe(BINARY_PATH);
			expect(pgp.verifySignature).not.toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Skipping binary signature verification due to settings",
			);
		});
	});
});

// Helper Classes
class MockConfigurationProvider implements ConfigurationProvider {
	private config = new Map<string, unknown>();

	set(key: string, value: unknown): void {
		this.config.set(key, value);
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.config.get(key);
		return value !== undefined ? (value as T) : defaultValue;
	}
}

class MockProgressReporter implements ProgressReporter {
	private shouldCancel = false;

	setCancellation(cancel: boolean): void {
		this.shouldCancel = cancel;
	}

	async withProgress<T>(
		_title: string,
		operation: (
			progress: {
				report: (value: { message?: string; increment?: number }) => void;
			},
			cancellationToken: {
				onCancellationRequested: (listener: () => void) => void;
			},
		) => Promise<T>,
	): Promise<T> {
		const mockToken = {
			onCancellationRequested: vi.fn((callback: () => void) => {
				if (this.shouldCancel) {
					setTimeout(callback, 0);
				}
			}),
		};
		return operation({ report: vi.fn() }, mockToken);
	}
}

class MockUserInteraction implements UserInteraction {
	private responses = new Map<string, string | undefined>();

	setResponse(response: string | undefined): void;
	setResponse(message: string, response: string | undefined): void;
	setResponse(
		messageOrResponse: string | undefined,
		response?: string | undefined,
	): void {
		if (response === undefined && messageOrResponse !== undefined) {
			// Single argument - set default response
			this.responses.set("default", messageOrResponse);
		} else if (messageOrResponse !== undefined) {
			// Two arguments - set specific response
			this.responses.set(messageOrResponse, response);
		}
	}

	showErrorMessage = vi.fn(
		async (message: string): Promise<string | undefined> => {
			return (
				(await this.responses.get(message)) ?? this.responses.get("default")
			);
		},
	);

	showWarningMessage = vi.fn(
		async (message: string): Promise<string | undefined> => {
			return (
				(await this.responses.get(message)) ?? this.responses.get("default")
			);
		},
	);

	openExternal = vi.fn();
}

// Helper Functions
function createMockLogger(): Logger {
	return {
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function createMockApi(version: string, url: string): Api {
	const mockAxios = {
		defaults: { baseURL: url },
		get: vi.fn(),
	} as unknown as AxiosInstance;

	return {
		getBuildInfo: vi.fn().mockResolvedValue({
			version,
			external_url: url,
			dashboard_url: url,
			telemetry: false,
			workspace_proxy: false,
			upgrade_message: "",
			deployment_id: "test",
			agent_api_version: "1.0",
			provisioner_api_version: "1.0",
		} as BuildInfoResponse),
		getAxiosInstance: vi.fn().mockReturnValue(mockAxios),
	} as unknown as Api;
}

function setupDefaultCliMocks(): void {
	vi.mocked(cli.name).mockReturnValue("coder");
	vi.mocked(cli.stat).mockResolvedValue(undefined);
	vi.mocked(cli.rmOld).mockResolvedValue([]);
	vi.mocked(cli.eTag).mockResolvedValue("");
	vi.mocked(cli.version).mockResolvedValue("1.2.3");
	vi.mocked(cli.goos).mockReturnValue("linux");
	vi.mocked(cli.goarch).mockReturnValue("amd64");
	vi.mocked(fse.mkdir).mockResolvedValue(undefined);
	vi.mocked(fse.rename).mockResolvedValue(undefined);
}

function setupExistingBinary(version: string): void {
	vi.mocked(cli.stat).mockResolvedValue({ size: 1024 } as Stats);
	vi.mocked(cli.version).mockResolvedValue(version);
}

function setupStreamMocks() {
	const mockWriteStream = {
		on: vi.fn().mockReturnThis(),
		write: vi.fn((_buffer: Buffer, callback?: () => void) => {
			callback?.();
		}),
		close: vi.fn(),
	} as unknown as WriteStream;

	const mockReadStream = createMockReadStream();

	return { mockWriteStream, mockReadStream };
}

function createMockReadStream(
	customHandler?: (event: string, callback: (data?: unknown) => void) => void,
): IncomingMessage {
	return {
		on: vi.fn((event: string, callback: (data?: unknown) => void) => {
			if (customHandler) {
				customHandler(event, callback);
			} else {
				if (event === "data") {
					setTimeout(() => callback(Buffer.from("mock-data")), 0);
				} else if (event === "close") {
					setTimeout(callback, 10);
				}
			}
		}),
		destroy: vi.fn(),
	} as unknown as IncomingMessage;
}

function createStreamResponse(status: number, stream: IncomingMessage) {
	return {
		status,
		headers: { "content-length": "1024" },
		data: stream,
	};
}

function setupSuccessfulDownload(mockApi: Api): void {
	const { mockWriteStream, mockReadStream } = setupStreamMocks();

	vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);
	const axios = mockApi.getAxiosInstance();
	axios.get = vi
		.fn()
		.mockResolvedValue(createStreamResponse(200, mockReadStream));
}

function setupSuccessfulDownloadWithSignature(mockApi: Api): void {
	const { mockWriteStream, mockReadStream } = setupStreamMocks();
	const signatureStream = createMockReadStream();

	vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);
	vi.mocked(cli.stat)
		.mockResolvedValueOnce(undefined)
		.mockResolvedValueOnce({ size: 1024 } as Stats);

	const axios = mockApi.getAxiosInstance() as AxiosInstance;
	axios.get = vi
		.fn()
		.mockResolvedValueOnce(createStreamResponse(200, mockReadStream)) // Binary
		.mockResolvedValueOnce(createStreamResponse(200, signatureStream)); // Signature
}
