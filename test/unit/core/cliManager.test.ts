import globalAxios, { type AxiosInstance } from "axios";
import { type Api } from "coder/site/src/api/api";
import EventEmitter from "events";
import * as fs from "fs";
import { type IncomingMessage } from "http";
import { fs as memfs, vol } from "memfs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { CliManager } from "@/core/cliManager";
import * as cliUtils from "@/core/cliUtils";
import { PathResolver } from "@/core/pathResolver";
import * as pgp from "@/pgp";

import {
	createMockLogger,
	MockConfigurationProvider,
	MockProgressReporter,
	MockUserInteraction,
} from "../../mocks/testHelpers";
import { expectPathsEqual } from "../../utils/platform";

vi.mock("os");
vi.mock("axios");
vi.mock("@/pgp");

vi.mock("fs", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return {
		...memfs.fs,
		default: memfs.fs,
	};
});

vi.mock("fs/promises", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return {
		...memfs.fs.promises,
		default: memfs.fs.promises,
	};
});

vi.mock("@/core/cliUtils", async () => {
	const actual =
		await vi.importActual<typeof import("@/core/cliUtils")>("@/core/cliUtils");
	return {
		...actual,
		// No need to test script execution here
		version: vi.fn(),
	};
});

describe("CliManager", () => {
	let manager: CliManager;
	let mockConfig: MockConfigurationProvider;
	let mockProgress: MockProgressReporter;
	let mockUI: MockUserInteraction;
	let mockApi: Api;
	let mockAxios: AxiosInstance;

	const TEST_VERSION = "1.2.3";
	const TEST_URL = "https://test.coder.com";
	const BASE_PATH = "/path/base";
	const BINARY_DIR = `${BASE_PATH}/test/bin`;
	const PLATFORM = "linux";
	const ARCH = "amd64";
	const BINARY_NAME = `coder-${PLATFORM}-${ARCH}`;
	const BINARY_PATH = `${BINARY_DIR}/${BINARY_NAME}`;

	beforeEach(() => {
		vi.resetAllMocks();
		vol.reset();

		// Core setup
		mockApi = createMockApi(TEST_VERSION, TEST_URL);
		mockAxios = mockApi.getAxiosInstance();
		vi.mocked(globalAxios.create).mockReturnValue(mockAxios);
		mockConfig = new MockConfigurationProvider();
		mockProgress = new MockProgressReporter();
		mockUI = new MockUserInteraction();
		manager = new CliManager(
			vscode,
			createMockLogger(),
			new PathResolver(BASE_PATH, "/code/log"),
		);

		// Mock only what's necessary
		vi.mocked(os.platform).mockReturnValue(PLATFORM);
		vi.mocked(os.arch).mockReturnValue(ARCH);
		vi.mocked(pgp.readPublicKeys).mockResolvedValue([]);
	});

	afterEach(async () => {
		mockProgress?.setCancellation(false);
		vi.clearAllTimers();
		// memfs internally schedules some FS operations so we have to wait for them to finish
		await new Promise((resolve) => setImmediate(resolve));
		vol.reset();
	});

	describe("Configure CLI", () => {
		it("should write both url and token to correct paths", async () => {
			await manager.configure(
				"deployment",
				"https://coder.example.com",
				"test-token",
			);

			expect(memfs.readFileSync("/path/base/deployment/url", "utf8")).toBe(
				"https://coder.example.com",
			);
			expect(memfs.readFileSync("/path/base/deployment/session", "utf8")).toBe(
				"test-token",
			);
		});

		it("should skip URL when undefined but write token", async () => {
			await manager.configure("deployment", undefined, "test-token");

			// No entry for the url
			expect(memfs.existsSync("/path/base/deployment/url")).toBe(false);
			expect(memfs.readFileSync("/path/base/deployment/session", "utf8")).toBe(
				"test-token",
			);
		});

		it("should skip token when null but write URL", async () => {
			await manager.configure("deployment", "https://coder.example.com", null);

			// No entry for the session
			expect(memfs.readFileSync("/path/base/deployment/url", "utf8")).toBe(
				"https://coder.example.com",
			);
			expect(memfs.existsSync("/path/base/deployment/session")).toBe(false);
		});

		it("should write empty string for token when provided", async () => {
			await manager.configure("deployment", "https://coder.example.com", "");

			expect(memfs.readFileSync("/path/base/deployment/url", "utf8")).toBe(
				"https://coder.example.com",
			);
			expect(memfs.readFileSync("/path/base/deployment/session", "utf8")).toBe(
				"",
			);
		});

		it("should use base path directly when label is empty", async () => {
			await manager.configure("", "https://coder.example.com", "token");

			expect(memfs.readFileSync("/path/base/url", "utf8")).toBe(
				"https://coder.example.com",
			);
			expect(memfs.readFileSync("/path/base/session", "utf8")).toBe("token");
		});
	});

	describe("Read CLI Configuration", () => {
		it("should read and trim stored configuration", async () => {
			// Create directories and write files with whitespace
			vol.mkdirSync("/path/base/deployment", { recursive: true });
			memfs.writeFileSync(
				"/path/base/deployment/url",
				"  https://coder.example.com  \n",
			);
			memfs.writeFileSync(
				"/path/base/deployment/session",
				"\t test-token \r\n",
			);

			const result = await manager.readConfig("deployment");

			expect(result).toEqual({
				url: "https://coder.example.com",
				token: "test-token",
			});
		});

		it("should return empty strings for missing files", async () => {
			const result = await manager.readConfig("deployment");

			expect(result).toEqual({
				url: "",
				token: "",
			});
		});

		it("should handle partial configuration", async () => {
			vol.mkdirSync("/path/base/deployment", { recursive: true });
			memfs.writeFileSync(
				"/path/base/deployment/url",
				"https://coder.example.com",
			);

			const result = await manager.readConfig("deployment");

			expect(result).toEqual({
				url: "https://coder.example.com",
				token: "",
			});
		});
	});

	describe("Binary Version Validation", () => {
		it("rejects invalid server versions", async () => {
			mockApi.getBuildInfo = vi.fn().mockResolvedValue({ version: "invalid" });
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Got invalid version from deployment",
			);
		});

		it("accepts valid semver versions", async () => {
			withExistingBinary(TEST_VERSION);
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
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
			expectPathsEqual(result, BINARY_PATH);
			expect(mockAxios.get).not.toHaveBeenCalled();
			// Verify binary still exists
			expect(memfs.existsSync(BINARY_PATH)).toBe(true);
		});

		it("downloads when versions differ", async () => {
			withExistingBinary("1.0.0");
			withSuccessfulDownload();
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			expect(mockAxios.get).toHaveBeenCalled();
			// Verify new binary exists
			expect(memfs.existsSync(BINARY_PATH)).toBe(true);
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent(TEST_VERSION),
			);
		});

		it("keeps mismatched binary when downloads disabled", async () => {
			mockConfig.set("coder.enableDownloads", false);
			withExistingBinary("1.0.0");
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			expect(mockAxios.get).not.toHaveBeenCalled();
			// Should still have the old version
			expect(memfs.existsSync(BINARY_PATH)).toBe(true);
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent("1.0.0"),
			);
		});

		it("downloads fresh binary when corrupted", async () => {
			withCorruptedBinary();
			withSuccessfulDownload();
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			expect(mockAxios.get).toHaveBeenCalled();
			expect(memfs.existsSync(BINARY_PATH)).toBe(true);
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent(TEST_VERSION),
			);
		});

		it("downloads when no binary exists", async () => {
			// Ensure directory doesn't exist initially
			expect(memfs.existsSync(BINARY_DIR)).toBe(false);

			withSuccessfulDownload();
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			expect(mockAxios.get).toHaveBeenCalled();

			// Verify directory was created and binary exists
			expect(memfs.existsSync(BINARY_DIR)).toBe(true);
			expect(memfs.existsSync(BINARY_PATH)).toBe(true);
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent(TEST_VERSION),
			);
		});

		it("fails when downloads disabled and no binary", async () => {
			mockConfig.set("coder.enableDownloads", false);
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Unable to download CLI because downloads are disabled",
			);
			expect(memfs.existsSync(BINARY_PATH)).toBe(false);
		});
	});

	describe("Binary Download Behavior", () => {
		beforeEach(() => {
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("downloads with correct headers", async () => {
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			expect(mockAxios.get).toHaveBeenCalledWith(
				`/bin/${BINARY_NAME}`,
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
				expect.objectContaining({
					responseType: "stream",
					decompress: true,
					validateStatus: expect.any(Function),
				}),
			);
		});

		it("uses ETag for existing binaries", async () => {
			withExistingBinary("1.0.0");
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");

			// Verify ETag was computed from actual file content
			expect(mockAxios.get).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						"If-None-Match": '"0c95a175da8afefd2b52057908a2e30ba2e959b3"',
					}),
				}),
			);
		});

		it("cleans up old files before download", async () => {
			// Create old temporary files and signature files
			vol.mkdirSync(BINARY_DIR, { recursive: true });
			memfs.writeFileSync(path.join(BINARY_DIR, "coder.old-xyz"), "old");
			memfs.writeFileSync(path.join(BINARY_DIR, "coder.temp-abc"), "temp");
			memfs.writeFileSync(path.join(BINARY_DIR, "coder.asc"), "signature");
			memfs.writeFileSync(path.join(BINARY_DIR, "keeper.txt"), "keep");

			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");

			// Verify old files were actually removed but other files kept
			expect(memfs.existsSync(path.join(BINARY_DIR, "coder.old-xyz"))).toBe(
				false,
			);
			expect(memfs.existsSync(path.join(BINARY_DIR, "coder.temp-abc"))).toBe(
				false,
			);
			expect(memfs.existsSync(path.join(BINARY_DIR, "coder.asc"))).toBe(false);
			expect(memfs.existsSync(path.join(BINARY_DIR, "keeper.txt"))).toBe(true);
		});

		it("moves existing binary to backup file before writing new version", async () => {
			withExistingBinary("1.0.0");
			withSuccessfulDownload();

			await manager.fetchBinary(mockApi, "test");

			// Verify the old binary was backed up
			const files = readdir(BINARY_DIR);
			const backupFile = files.find(
				(f) => f.startsWith(BINARY_NAME) && f.match(/\.old-[a-z0-9]+$/),
			);
			expect(backupFile).toBeDefined();
		});
	});

	describe("Download HTTP Response Handling", () => {
		beforeEach(() => {
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("handles 304 Not Modified", async () => {
			withExistingBinary("1.0.0");
			withHttpResponse(304);
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			// No change
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent("1.0.0"),
			);
		});

		it("handles 404 platform not supported", async () => {
			withHttpResponse(404);
			mockUI.setResponse(
				"Coder isn't supported for your platform. Please open an issue, we'd love to support it!",
				"Open an Issue",
			);
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
			mockUI.setResponse(
				"Failed to download binary. Please open an issue.",
				"Open an Issue",
			);
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

	describe("Download Stream Handling", () => {
		beforeEach(() => {
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("handles write stream errors", async () => {
			withStreamError("write", "disk full");
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Unable to download binary: disk full",
			);
			expect(memfs.existsSync(BINARY_PATH)).toBe(false);
		});

		it("handles read stream errors", async () => {
			withStreamError("read", "network timeout");
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Unable to download binary: network timeout",
			);
			expect(memfs.existsSync(BINARY_PATH)).toBe(false);
		});

		it("handles missing content-length", async () => {
			withSuccessfulDownload({ headers: {} });
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			expect(memfs.existsSync(BINARY_PATH)).toBe(true);
		});
	});

	describe("Download Progress Tracking", () => {
		beforeEach(() => {
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
			expect(memfs.existsSync(BINARY_PATH)).toBe(false);
		});
	});

	describe("Binary Signature Verification", () => {
		it("verifies valid signatures", async () => {
			withSuccessfulDownload();
			withSignatureResponses([200]);
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			expect(pgp.verifySignature).toHaveBeenCalled();
			const sigFile = expectFileInDir(BINARY_DIR, ".asc");
			expect(sigFile).toBeDefined();
		});

		it("tries fallback signature on 404", async () => {
			withSuccessfulDownload();
			withSignatureResponses([404, 200]);
			mockUI.setResponse("Signature not found", "Download signature");
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			expect(mockAxios.get).toHaveBeenCalledTimes(3);
			const sigFile = expectFileInDir(BINARY_DIR, ".asc");
			expect(sigFile).toBeDefined();
		});

		it("allows running despite invalid signature", async () => {
			withSuccessfulDownload();
			withSignatureResponses([200]);
			vi.mocked(pgp.verifySignature).mockRejectedValueOnce(
				createVerificationError("Invalid signature"),
			);
			mockUI.setResponse("Signature does not match", "Run anyway");
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			expect(memfs.existsSync(BINARY_PATH)).toBe(true);
		});

		it("aborts on signature rejection", async () => {
			withSuccessfulDownload();
			withSignatureResponses([200]);
			vi.mocked(pgp.verifySignature).mockRejectedValueOnce(
				createVerificationError("Invalid signature"),
			);
			mockUI.setResponse("Signature does not match", undefined);
			await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
				"Signature verification aborted",
			);
		});

		it("skips verification when disabled", async () => {
			mockConfig.set("coder.disableSignatureVerification", true);
			withSuccessfulDownload();
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			expect(pgp.verifySignature).not.toHaveBeenCalled();
			const files = readdir(BINARY_DIR);
			expect(files.find((file) => file.includes(".asc"))).toBeUndefined();
		});

		type SignatureErrorTestCase = [status: number, message: string];
		it.each<SignatureErrorTestCase>([
			[404, "Signature not found"],
			[500, "Failed to download signature"],
		])("allows skipping verification on %i", async (status, message) => {
			withSuccessfulDownload();
			withHttpResponse(status);
			mockUI.setResponse(message, "Run without verification");
			const result = await manager.fetchBinary(mockApi, "test");
			expectPathsEqual(result, BINARY_PATH);
			expect(pgp.verifySignature).not.toHaveBeenCalled();
		});

		it.each<SignatureErrorTestCase>([
			[404, "Signature not found"],
			[500, "Failed to download signature"],
		])(
			"aborts when user declines missing signature on %i",
			async (status, message) => {
				withSuccessfulDownload();
				withHttpResponse(status);
				mockUI.setResponse(message, undefined); // User cancels
				await expect(manager.fetchBinary(mockApi, "test")).rejects.toThrow(
					"Signature download aborted",
				);
			},
		);
	});

	describe("File System Operations", () => {
		beforeEach(() => {
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("creates binary directory", async () => {
			expect(memfs.existsSync(BINARY_DIR)).toBe(false);
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			expect(memfs.existsSync(BINARY_DIR)).toBe(true);
			const stats = memfs.statSync(BINARY_DIR);
			expect(stats.isDirectory()).toBe(true);
		});

		it("validates downloaded binary version", async () => {
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent(TEST_VERSION),
			);
		});

		it("sets correct file permissions", async () => {
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi, "test");
			const stats = memfs.statSync(BINARY_PATH);
			expect(stats.mode & 0o777).toBe(0o755);
		});
	});

	describe("Path Pecularities", () => {
		beforeEach(() => {
			mockConfig.set("coder.disableSignatureVerification", true);
		});

		it("handles binary with spaces in path", async () => {
			const pathWithSpaces = "/path with spaces/bin";
			const resolver = new PathResolver(pathWithSpaces, "/log");
			const manager = new CliManager(vscode, createMockLogger(), resolver);

			withSuccessfulDownload();
			const result = await manager.fetchBinary(mockApi, "test label");
			expectPathsEqual(
				result,
				`${pathWithSpaces}/test label/bin/${BINARY_NAME}`,
			);
		});

		it("handles empty deployment label", async () => {
			withExistingBinary(TEST_VERSION, "/path/base/bin");
			const result = await manager.fetchBinary(mockApi, "");
			expectPathsEqual(result, path.join(BASE_PATH, "bin", BINARY_NAME));
		});
	});

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

	function withExistingBinary(version: string, dir: string = BINARY_DIR) {
		vol.mkdirSync(dir, { recursive: true });
		memfs.writeFileSync(`${dir}/${BINARY_NAME}`, mockBinaryContent(version), {
			mode: 0o755,
		});

		// Mock version to return the specified version
		vi.mocked(cliUtils.version).mockResolvedValueOnce(version);
	}

	function withCorruptedBinary() {
		vol.mkdirSync(BINARY_DIR, { recursive: true });
		memfs.writeFileSync(BINARY_PATH, "corrupted-binary-content", {
			mode: 0o755,
		});

		// Mock version to fail
		vi.mocked(cliUtils.version).mockRejectedValueOnce(new Error("corrupted"));
	}

	function withSuccessfulDownload(opts?: {
		headers?: Record<string, unknown>;
	}) {
		const stream = createMockStream(mockBinaryContent(TEST_VERSION));
		withHttpResponse(
			200,
			opts?.headers ?? { "content-length": "1024" },
			stream,
		);

		// Mock version to return TEST_VERSION after download
		vi.mocked(cliUtils.version).mockResolvedValue(TEST_VERSION);
	}

	function withSignatureResponses(statuses: number[]): void {
		statuses.forEach((status) => {
			const data =
				status === 200 ? createMockStream("mock-signature-content") : undefined;
			withHttpResponse(status, {}, data);
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
		if (type === "write") {
			vi.spyOn(fs, "createWriteStream").mockImplementation(() => {
				const stream = new EventEmitter();
				(stream as unknown as fs.WriteStream).write = vi.fn();
				(stream as unknown as fs.WriteStream).close = vi.fn();
				// Emit error on next tick after stream is returned
				setImmediate(() => {
					stream.emit("error", new Error(message));
				});

				return stream as ReturnType<typeof memfs.createWriteStream>;
			});

			// Provide a normal read stream
			withHttpResponse(
				200,
				{ "content-length": "256" },
				createMockStream("data"),
			);
		} else {
			// Create a read stream that emits error
			const errorStream = {
				on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
					if (event === "error") {
						setImmediate(() => callback(new Error(message)));
					}
					return errorStream;
				}),
				destroy: vi.fn(),
			} as unknown as IncomingMessage;

			withHttpResponse(200, { "content-length": "1024" }, errorStream);
		}
	}

	function createMockStream(
		content: string,
		options: { chunkSize?: number; delay?: number } = {},
	): IncomingMessage {
		const { chunkSize = 8, delay = 1 } = options;

		const buffer = Buffer.from(content);
		let position = 0;
		let closeCallback: ((...args: unknown[]) => void) | null = null;

		return {
			on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
				if (event === "data") {
					// Send data in chunks
					const sendChunk = () => {
						if (position < buffer.length) {
							const chunk = buffer.subarray(
								position,
								Math.min(position + chunkSize, buffer.length),
							);
							position += chunkSize;
							callback(chunk);
							if (position < buffer.length) {
								setTimeout(sendChunk, delay);
							} else {
								// All chunks sent - use setImmediate to ensure close happens
								// after all synchronous operations and I/O callbacks complete
								setImmediate(() => {
									if (closeCallback) {
										closeCallback();
									}
								});
							}
						}
					};
					setTimeout(sendChunk, delay);
				} else if (event === "close") {
					closeCallback = callback;
				}
			}),
			destroy: vi.fn(),
		} as unknown as IncomingMessage;
	}

	function createVerificationError(msg: string): pgp.VerificationError {
		const error = new pgp.VerificationError(
			pgp.VerificationErrorCode.Invalid,
			msg,
		);
		vi.mocked(error.summary).mockReturnValue("Signature does not match");
		return error;
	}

	function mockBinaryContent(version: string): string {
		return `mock-binary-v${version}`;
	}

	function expectFileInDir(dir: string, pattern: string): string | undefined {
		const files = readdir(dir);
		return files.find((f) => f.includes(pattern));
	}

	function readdir(dir: string): string[] {
		return memfs.readdirSync(dir) as string[];
	}
});
