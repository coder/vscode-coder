import globalAxios, { AxiosInstance } from "axios";
import { Api } from "coder/site/src/api/api";
import * as fs from "fs";
import * as fse from "fs/promises";
import { IncomingMessage } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	MockConfigurationProvider,
	MockProgressReporter,
	MockUserInteraction,
} from "../__mocks__/testHelpers";
import * as cli from "../cliManager";
import { Logger } from "../logging/logger";
import * as pgp from "../pgp";
import { BinaryManager } from "./binaryManager";
import { PathResolver } from "./pathResolver";

// Mock all external modules
vi.mock("axios");
vi.mock("fs/promises");
vi.mock("fs");
vi.mock("../cliManager");
vi.mock("../pgp");

describe("BinaryManager", () => {
	let manager: BinaryManager;
	let mockLogger: Logger;
	let mockConfig: MockConfigurationProvider;
	let mockProgress: MockProgressReporter;
	let mockUI: MockUserInteraction;
	let mockApi: Api;
	let mockAxios: AxiosInstance;

	const TEST_VERSION = "1.2.3";
	const TEST_URL = "https://test.coder.com";
	const BINARY_PATH = "/path/base/test/bin/coder";

	beforeEach(() => {
		vi.resetAllMocks();

		// Core setup
		mockLogger = createMockLogger();
		mockApi = createMockApi(TEST_VERSION, TEST_URL);
		mockAxios = mockApi.getAxiosInstance();
		vi.mocked(globalAxios.create).mockReturnValue(mockAxios);
		mockConfig = new MockConfigurationProvider();
		mockProgress = new MockProgressReporter();
		mockUI = new MockUserInteraction();
		manager = new BinaryManager(
			mockLogger,
			new PathResolver("/path/base", "/code/log"),
		);

		// Default mocks - most tests rely on these
		vi.mocked(cli.name).mockReturnValue("coder");
		vi.mocked(cli.stat).mockResolvedValue(undefined); // No existing binary by default
		vi.mocked(cli.rmOld).mockResolvedValue([]);
		vi.mocked(cli.eTag).mockResolvedValue("");
		vi.mocked(cli.version).mockResolvedValue(TEST_VERSION);
		vi.mocked(cli.goos).mockReturnValue("linux");
		vi.mocked(cli.goarch).mockReturnValue("amd64");
		vi.mocked(fse.mkdir).mockResolvedValue(undefined);
		vi.mocked(fse.rename).mockResolvedValue(undefined);
		vi.mocked(pgp.readPublicKeys).mockResolvedValue([]);
	});

	afterEach(() => {
		mockProgress?.setCancellation(false);
		vi.clearAllTimers();
	});

	describe("Version Validation", () => {
		it("rejects invalid server versions", async () => {
			mockApi.getBuildInfo = vi.fn().mockResolvedValue({ version: "invalid" });
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Got invalid version from deployment",
			);
		});

		it("accepts valid semver versions", async () => {
			withExistingBinary(TEST_VERSION);
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
		});
	});

	describe("Existing Binary Handling", () => {
		beforeEach(() => {
			// Disable signature verification for these tests
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("reuses matching binary without downloading", async () => {
			withExistingBinary(TEST_VERSION);
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(mockAxios.get).not.toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining(
					"Using existing binary since it matches the server version",
				),
			);
		});

		it("downloads when versions differ", async () => {
			withExistingBinary("1.0.0");
			withSuccessfulDownload();
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(mockAxios.get).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Downloaded binary version is",
				TEST_VERSION,
			);
		});

		it("keeps mismatched binary when downloads disabled", async () => {
			mockConfig.set("coder.enableDownloads", false);
			withExistingBinary("1.0.0");
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(mockAxios.get).not.toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining(
					"Using existing binary even though it does not match the server version",
				),
			);
		});

		it("downloads fresh binary when corrupted", async () => {
			withCorruptedBinary();
			withSuccessfulDownload();
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Unable to get version"),
			);
			// Should attempt to download now
			expect(mockAxios.get).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Downloaded binary version is",
				TEST_VERSION,
			);
		});

		it("downloads when no binary exists", async () => {
			withSuccessfulDownload();
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(mockAxios.get).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				"No existing binary found, starting download",
			);
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Downloaded binary version is",
				TEST_VERSION,
			);
		});

		it("fails when downloads disabled and no binary", async () => {
			mockConfig.set("coder.enableDownloads", false);
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Unable to download CLI because downloads are disabled",
			);
		});
	});

	describe("Download Behavior", () => {
		beforeEach(() => {
			// Disable signature verification for download behavior tests
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("downloads with correct headers", async () => {
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			expect(mockAxios.get).toHaveBeenCalledWith(
				"/bin/coder",
				expect.objectContaining({
					responseType: "stream",
					headers: expect.objectContaining({
						"Accept-Encoding": "gzip",
						"If-None-Match": '""',
					}),
				}),
			);
		});

		it("uses custom binary source", async () => {
			mockConfig.set("coder.binarySource", "/custom/path");
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			expect(mockAxios.get).toHaveBeenCalledWith(
				"/custom/path",
				expect.any(Object),
			);
		});

		it("uses ETag for existing binaries", async () => {
			withExistingBinary("1.0.0");
			vi.mocked(cli.eTag).mockResolvedValueOnce("abc123");
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			expect(mockAxios.get).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({ "If-None-Match": '"abc123"' }),
				}),
			);
		});

		it("cleans up old files before download", async () => {
			vi.mocked(cli.rmOld).mockResolvedValueOnce([
				{ fileName: "coder.old-xyz", error: undefined },
				{ fileName: "coder.temp-abc", error: undefined },
			]);
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			expect(cli.rmOld).toHaveBeenCalledWith(BINARY_PATH);
			expect(mockLogger.info).toHaveBeenCalledWith("Removed", "coder.old-xyz");
			expect(mockLogger.info).toHaveBeenCalledWith("Removed", "coder.temp-abc");
		});

		it("backs up existing binary before replacement", async () => {
			withExistingBinary("1.0.0");
			withSuccessfulDownload();

			await manager.fetchBinary(mockApi, "test");
			expect(fse.rename).toHaveBeenCalledWith(
				BINARY_PATH,
				expect.stringMatching(/\.old-[a-z0-9]+$/),
			);
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Moving existing binary to",
				expect.stringMatching(/\.old-[a-z0-9]+$/),
			);
		});
	});

	describe("HTTP Response Handling", () => {
		beforeEach(() => {
			// Disable signature verification for these tests
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("handles 304 Not Modified", async () => {
			withExistingBinary("1.0.0");
			withHttpResponse(304);
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Using existing binary since server returned a 304",
			);
		});

		it("handles 404 platform not supported", async () => {
			withHttpResponse(404);
			mockUI.setResponse("Open an Issue");
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Platform not supported",
			);
			expect(vscode.env.openExternal).toHaveBeenCalledWith(
				expect.objectContaining({
					path: expect.stringContaining(
						"github.com/coder/vscode-coder/issues/new?",
					),
				}),
			);
		});

		it("handles server errors", async () => {
			withHttpResponse(500);
			mockUI.setResponse("Open an Issue");
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Failed to download binary",
			);
			expect(vscode.env.openExternal).toHaveBeenCalledWith(
				expect.objectContaining({
					path: expect.stringContaining(
						"github.com/coder/vscode-coder/issues/new?",
					),
				}),
			);
		});
	});

	describe("Stream Handling", () => {
		beforeEach(() => {
			// Disable signature verification for these tests
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("handles write stream errors", async () => {
			withStreamError("write", "disk full");
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Unable to download binary: disk full",
			);
		});

		it("handles read stream errors", async () => {
			withStreamError("read", "network timeout");
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Unable to download binary: network timeout",
			);
		});

		it("handles missing content-length", async () => {
			withSuccessfulDownload({ headers: {} });
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				"Got invalid or missing content length",
				undefined,
			);
		});
	});

	describe("Progress Tracking", () => {
		beforeEach(() => {
			// Disable signature verification for these tests
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("shows download progress", async () => {
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			expect(vscode.window.withProgress).toHaveBeenCalledWith(
				expect.objectContaining({ title: `Downloading ${TEST_URL}` }),
				expect.any(Function),
			);
		});

		it("handles user cancellation", async () => {
			mockProgress.setCancellation(true);
			withSuccessfulDownload();
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Download aborted",
			);
		});
	});

	describe("Signature Verification", () => {
		it("verifies valid signatures", async () => {
			withSuccessfulDownload();
			withSignatureResponses([200]);
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(pgp.verifySignature).toHaveBeenCalled();
		});

		it("tries fallback signature on 404", async () => {
			withSuccessfulDownload();
			withSignatureResponses([404, 200]);
			mockUI.setResponse("Download signature");
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				"Signature not found",
				expect.any(Object),
				expect.any(String),
				expect.any(String),
			);
			// First download and when verfiying twice (404 then 200)
			expect(mockAxios.get).toHaveBeenCalledTimes(3);
		});

		it("allows running despite invalid signature", async () => {
			withSuccessfulDownload();
			withSignatureResponses([200]);
			vi.mocked(pgp.verifySignature).mockRejectedValueOnce(
				createVerificationError("Invalid signature"),
			);
			mockUI.setResponse("Run anyway");
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Binary will be ran anyway at user request",
			);
		});

		it("aborts on signature rejection", async () => {
			withSuccessfulDownload();
			withSignatureResponses([200]);
			vi.mocked(pgp.verifySignature).mockRejectedValueOnce(
				createVerificationError("Invalid signature"),
			);
			mockUI.setResponse(undefined);
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Signature verification aborted",
			);
		});

		it("skips verification when disabled", async () => {
			mockConfig.set("coder.disableSignatureVerification", true);
			withSuccessfulDownload();
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(pgp.verifySignature).not.toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Skipping binary signature verification due to settings",
			);
		});

		it("allows skipping verification on 404", async () => {
			withSuccessfulDownload();
			withHttpResponse(404);
			mockUI.setResponse("Run without verification");
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(pgp.verifySignature).not.toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringMatching(/Signature download from (.+) declined/),
			);
		});

		it("handles signature download failure", async () => {
			withSuccessfulDownload();
			withHttpResponse(500);
			mockUI.setResponse("Run without verification");
			const result = await manager.fetchBinary(mockApi, "test");
			expect(result).toBe(BINARY_PATH);
			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				"Failed to download signature",
				expect.any(Object),
				"Download signature", // from the next source
				"Run without verification",
			);
		});

		it("aborts when user declines missing signature", async () => {
			withSuccessfulDownload();
			withHttpResponse(404);
			mockUI.setResponse(undefined); // User cancels
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Signature download aborted",
			);
		});
	});

	describe("File System Operations", () => {
		beforeEach(() => {
			// Disable signature verification for these tests
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("creates binary directory", async () => {
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			expect(fse.mkdir).toHaveBeenCalledWith(expect.stringContaining("/bin"), {
				recursive: true,
			});
		});

		it("validates downloaded binary version", async () => {
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			expect(cli.version).toHaveBeenCalledWith(BINARY_PATH);
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Downloaded binary version is",
				TEST_VERSION,
			);
		});

		it("logs file sizes for debugging", async () => {
			withSuccessfulDownload();
			vi.mocked(cli.stat).mockResolvedValueOnce({ size: 5242880 } as fs.Stats);
			await manager.fetchBinary(mockApi, "test");
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Downloaded binary size is",
				"5.24 MB",
			);
		});
	});

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
		const axios = {
			defaults: { baseURL: url },
			get: vi.fn(),
		} as unknown as AxiosInstance;
		return {
			getBuildInfo: vi.fn().mockResolvedValue({ version }),
			getAxiosInstance: () => axios,
		} as unknown as Api;
	}

	function withExistingBinary(version: string) {
		vi.mocked(cli.stat).mockReset();
		vi.mocked(cli.stat).mockResolvedValueOnce({ size: 1024 } as fs.Stats);
		vi.mocked(cli.version).mockReset();
		vi.mocked(cli.version).mockResolvedValueOnce(version);
	}

	function withCorruptedBinary() {
		vi.mocked(cli.stat).mockReset();
		vi.mocked(cli.stat).mockResolvedValueOnce({ size: 1024 } as fs.Stats); // Existing binary exists
		vi.mocked(cli.version).mockReset();
		vi.mocked(cli.version).mockRejectedValueOnce(new Error("corrupted")); // Existing binary is corrupted
	}

	/**
	 * Shouldn't reset mocks since this method is combined with other mocks.
	 */
	function withSuccessfulDownload(opts?: {
		headers?: Record<string, unknown>;
	}) {
		const stream = createMockStream();
		const writeStream = createMockWriteStream();
		withHttpResponse(
			200,
			opts?.headers ?? { "content-length": "1024" },
			stream,
		);
		vi.mocked(fs.createWriteStream).mockReturnValue(writeStream);
		// Ensure no existing binary initially, then file exists after download
		vi.mocked(cli.stat)
			.mockResolvedValueOnce(undefined) // No existing binary
			.mockResolvedValueOnce({ size: 5242880 } as fs.Stats); // After download
		// Version check after download
		vi.mocked(cli.version).mockResolvedValueOnce(TEST_VERSION);
	}

	function withSignatureResponses(statuses: number[]) {
		statuses.forEach((status) => {
			if (status === 200) {
				withHttpResponse(200, { "content-length": "256" }, createMockStream());
			} else {
				withHttpResponse(status);
			}
		});
	}

	function withHttpResponse(
		status: number,
		headers: Record<string, unknown> = {},
		data?: unknown,
	) {
		vi.mocked(mockAxios.get).mockResolvedValueOnce({
			status,
			headers,
			data,
		});
	}

	function withStreamError(type: "read" | "write", message: string) {
		const writeStream = createMockWriteStream();
		const readStream = createMockStream();

		if (type === "write") {
			writeStream.on = vi.fn((event, callback) => {
				if (event === "error") {
					setTimeout(() => callback(new Error(message)), 5);
				}
				return writeStream;
			});
		} else {
			readStream.on = vi.fn((event, callback) => {
				if (event === "error") {
					setTimeout(() => callback(new Error(message)), 5);
				}
				return readStream;
			});
		}

		withHttpResponse(200, { "content-length": "1024" }, readStream);
		vi.mocked(fs.createWriteStream).mockReturnValue(writeStream);
	}

	function createMockStream(): IncomingMessage {
		return {
			on: vi.fn((event: string, callback: (data: unknown) => void) => {
				if (event === "data") {
					setTimeout(() => callback(Buffer.from("mock")), 0);
				} else if (event === "close") {
					setTimeout(callback, 10);
				}
			}),
			destroy: vi.fn(),
		} as unknown as IncomingMessage;
	}

	function createMockWriteStream(): fs.WriteStream {
		return {
			on: vi.fn().mockReturnThis(),
			write: vi.fn((_: Buffer, cb?: () => void) => cb?.()),
			close: vi.fn(),
		} as unknown as fs.WriteStream;
	}

	function createVerificationError(msg: string): pgp.VerificationError {
		const error = new pgp.VerificationError(
			pgp.VerificationErrorCode.Invalid,
			msg,
		);
		return error;
	}
});
