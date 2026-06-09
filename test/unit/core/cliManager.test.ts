import { fs as memfs, vol } from "memfs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import * as pgp from "@/pgp";
import { isKeyringEnabled } from "@/settings/cli";

import { expectPathsEqual } from "../../utils/platform";

import {
	BINARY_DIR,
	BINARY_NAME,
	BINARY_PATH,
	type CliManagerHarness,
	expectFileInDir,
	flushPendingIO,
	makeAbortError,
	mockBinaryContent,
	readdir,
	setupCliManager,
	TEST_URL,
	TEST_VERSION,
} from "./cliManagerHarness";

import type * as fs from "node:fs";

vi.mock("os");
vi.mock("axios");
vi.mock("@/settings/cli", async () => {
	const actual =
		await vi.importActual<typeof import("@/settings/cli")>("@/settings/cli");
	return { ...actual, isKeyringEnabled: vi.fn().mockReturnValue(false) };
});

vi.mock("fs", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return { ...memfs.fs, default: memfs.fs };
});

vi.mock("fs/promises", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return { ...memfs.fs.promises, default: memfs.fs.promises };
});

vi.mock("proper-lockfile", () => ({
	lock: () => Promise.resolve(() => Promise.resolve()),
	check: () => Promise.resolve(false),
}));

vi.mock("@/pgp");

vi.mock("@/core/cliExec", async () => {
	const actual =
		await vi.importActual<typeof import("@/core/cliExec")>("@/core/cliExec");
	return { ...actual, version: vi.fn() };
});

describe("CliManager", () => {
	afterEach(flushPendingIO);

	describe("Configure CLI", () => {
		const URL = "https://coder.example.com";
		const TOKEN = "test-token";

		it("should store credentials with progress notification", async () => {
			const { manager, mockCredManager } = setupCliManager();

			await manager.configure(URL, TOKEN);

			expect(vscode.window.withProgress).toHaveBeenCalledWith(
				expect.objectContaining({
					location: vscode.ProgressLocation.Notification,
					title: `Storing credentials for ${URL}`,
					cancellable: true,
				}),
				expect.any(Function),
			);
			expect(mockCredManager.storeToken).toHaveBeenCalledWith(
				URL,
				TOKEN,
				expect.anything(),
				{ signal: expect.any(AbortSignal) },
			);
		});

		it("should skip progress when silent", async () => {
			const { manager, mockCredManager } = setupCliManager();

			await manager.configure(URL, TOKEN, { silent: true });

			expect(vscode.window.withProgress).not.toHaveBeenCalled();
			expect(mockCredManager.storeToken).toHaveBeenCalledWith(
				URL,
				TOKEN,
				expect.anything(),
			);
		});

		it("should throw when URL is empty", async () => {
			const { manager } = setupCliManager();

			await expect(manager.configure("", TOKEN)).rejects.toThrow(
				"URL is required to configure the CLI",
			);
		});

		it.each([{ silent: false }, { silent: true }])(
			"should throw and show error on failure (silent=$silent)",
			async (options) => {
				const { manager, mockCredManager } = setupCliManager();
				vi.mocked(mockCredManager.storeToken).mockRejectedValueOnce(
					new Error("keyring unavailable"),
				);

				await expect(manager.configure(URL, TOKEN, options)).rejects.toThrow(
					"keyring unavailable",
				);
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
					expect.stringContaining("keyring unavailable"),
					"Open Settings",
				);
			},
		);

		it("should swallow AbortError when user cancels", async () => {
			const { manager, mockCredManager } = setupCliManager();
			vi.mocked(mockCredManager.storeToken).mockRejectedValueOnce(
				makeAbortError(),
			);

			await expect(manager.configure(URL, TOKEN)).resolves.not.toThrow();
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		});
	});

	describe("Locate Binary", () => {
		it("returns path when binary exists", async () => {
			const { manager, withExistingBinary } = setupCliManager();
			withExistingBinary(TEST_VERSION);
			expectPathsEqual(await manager.locateBinary(TEST_URL), BINARY_PATH);
		});

		it("throws when binary does not exist", async () => {
			const { manager } = setupCliManager();
			await expect(manager.locateBinary(TEST_URL)).rejects.toThrow(
				"No CLI binary found at",
			);
		});
	});

	describe("Binary Resolution", () => {
		/** Simulate a write failure where the user accepts the existing fallback. */
		function withFailedDownload(t: CliManagerHarness, fallbackVersion: string) {
			t.withStreamError("write", "disk full");
			t.withBinaryVersion(fallbackVersion);
			t.mockUI.setResponse(
				`Failed to update CLI binary. Run version ${fallbackVersion} anyway?`,
				"Run",
			);
		}

		describe("file destination", () => {
			const FILE_PATH = "/usr/local/bin/coder";
			const DOWNLOAD_PATH = path.join(path.dirname(FILE_PATH), BINARY_NAME);

			function withFileBinary(
				t: CliManagerHarness,
				filePath: string,
				version: string,
			) {
				t.mockConfig.set("coder.binaryDestination", filePath);
				vol.mkdirSync(path.dirname(filePath), { recursive: true });
				memfs.writeFileSync(filePath, mockBinaryContent(version), {
					mode: 0o755,
				});
				t.withBinaryVersion(version);
			}

			it("locateBinary returns file path directly", async () => {
				const t = setupCliManager();
				withFileBinary(t, FILE_PATH, TEST_VERSION);
				expectPathsEqual(await t.manager.locateBinary(TEST_URL), FILE_PATH);
			});

			it("locateBinary throws when file does not exist", async () => {
				const { manager, mockConfig } = setupCliManager();
				mockConfig.set("coder.binaryDestination", "/nonexistent/coder");
				await expect(manager.locateBinary(TEST_URL)).rejects.toThrow(
					"No CLI binary found at",
				);
			});

			it("fetchBinary uses file when version matches", async () => {
				const t = setupCliManager();
				withFileBinary(t, FILE_PATH, TEST_VERSION);
				expectPathsEqual(await t.manager.fetchBinary(t.mockApi), FILE_PATH);
				expect(t.mockAxios.get).not.toHaveBeenCalled();
			});

			it("fetchBinary downloads to platform-specific name then renames", async () => {
				const t = setupCliManager();
				withFileBinary(t, FILE_PATH, "0.0.1");
				t.withSuccessfulDownload();

				expectPathsEqual(await t.manager.fetchBinary(t.mockApi), FILE_PATH);
				expect(memfs.existsSync(DOWNLOAD_PATH)).toBe(false);
				expect(memfs.readFileSync(FILE_PATH).toString()).toBe(
					mockBinaryContent(TEST_VERSION),
				);
			});

			it("fetchBinary downloads in-place when file is already platform-specific", async () => {
				const t = setupCliManager();
				// User configured a path that matches the platform-specific name.
				withFileBinary(t, DOWNLOAD_PATH, "0.0.1");
				t.withSuccessfulDownload();

				expectPathsEqual(await t.manager.fetchBinary(t.mockApi), DOWNLOAD_PATH);
				expect(memfs.readFileSync(DOWNLOAD_PATH).toString()).toBe(
					mockBinaryContent(TEST_VERSION),
				);
			});

			it("fetchBinary keeps mismatched file when downloads disabled", async () => {
				const t = setupCliManager();
				t.mockConfig.set("coder.enableDownloads", false);
				withFileBinary(t, FILE_PATH, "0.0.1");
				expectPathsEqual(await t.manager.fetchBinary(t.mockApi), FILE_PATH);
				expect(t.mockAxios.get).not.toHaveBeenCalled();
			});

			it("fetchBinary falls back to configured path on download failure", async () => {
				const t = setupCliManager();
				withFileBinary(t, FILE_PATH, "0.0.1");
				withFailedDownload(t, "0.0.1");
				expectPathsEqual(await t.manager.fetchBinary(t.mockApi), FILE_PATH);
			});

			it("fetchBinary renames fallback to configured path on download failure", async () => {
				const t = setupCliManager();
				withFileBinary(t, FILE_PATH, "0.0.1");
				// A previous download left a binary at the platform-specific path.
				memfs.writeFileSync(DOWNLOAD_PATH, mockBinaryContent("0.0.1"), {
					mode: 0o755,
				});
				withFailedDownload(t, "0.0.1");

				expectPathsEqual(await t.manager.fetchBinary(t.mockApi), FILE_PATH);
				expect(memfs.existsSync(DOWNLOAD_PATH)).toBe(false);
			});
		});

		describe("simple name fallback", () => {
			const SIMPLE_PATH = `${BINARY_DIR}/coder`;

			function withSimpleBinary(t: CliManagerHarness, version: string) {
				vol.mkdirSync(BINARY_DIR, { recursive: true });
				memfs.writeFileSync(SIMPLE_PATH, mockBinaryContent(version), {
					mode: 0o755,
				});
				t.withBinaryVersion(version);
			}

			it("locateBinary falls back to simple name", async () => {
				const t = setupCliManager();
				withSimpleBinary(t, TEST_VERSION);
				expectPathsEqual(await t.manager.locateBinary(TEST_URL), SIMPLE_PATH);
			});

			it("locateBinary prefers platform-specific name", async () => {
				const t = setupCliManager();
				withSimpleBinary(t, TEST_VERSION);
				memfs.writeFileSync(BINARY_PATH, mockBinaryContent(TEST_VERSION), {
					mode: 0o755,
				});
				expectPathsEqual(await t.manager.locateBinary(TEST_URL), BINARY_PATH);
			});

			it("fetchBinary uses simple-named binary", async () => {
				const t = setupCliManager();
				withSimpleBinary(t, TEST_VERSION);
				expectPathsEqual(await t.manager.fetchBinary(t.mockApi), SIMPLE_PATH);
				expect(t.mockAxios.get).not.toHaveBeenCalled();
			});

			it("fetchBinary downloads to platform-specific name (not simple name)", async () => {
				const t = setupCliManager();
				withSimpleBinary(t, "0.0.1");
				t.withSuccessfulDownload();

				expectPathsEqual(await t.manager.fetchBinary(t.mockApi), BINARY_PATH);
				expect(memfs.readFileSync(SIMPLE_PATH).toString()).toBe(
					mockBinaryContent("0.0.1"),
				);
				expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
					mockBinaryContent(TEST_VERSION),
				);
			});

			it("fetchBinary falls back to simple name on download failure", async () => {
				const t = setupCliManager();
				withSimpleBinary(t, "0.0.1");
				withFailedDownload(t, "0.0.1");
				expectPathsEqual(await t.manager.fetchBinary(t.mockApi), SIMPLE_PATH);
			});
		});
	});

	describe("Clear Credentials", () => {
		const CLEAR_URL = "https://dev.coder.com";

		it("should skip progress notification when keyring is disabled", async () => {
			const { manager, mockCredManager } = setupCliManager();

			await manager.clearCredentials(CLEAR_URL);

			expect(vscode.window.withProgress).not.toHaveBeenCalled();
			expect(mockCredManager.deleteToken).toHaveBeenCalledWith(
				CLEAR_URL,
				expect.anything(),
				{ signal: expect.any(AbortSignal) },
			);
		});

		it("should show progress notification when keyring is enabled", async () => {
			const { manager } = setupCliManager();
			vi.mocked(isKeyringEnabled).mockReturnValue(true);

			await manager.clearCredentials(CLEAR_URL);

			expect(vscode.window.withProgress).toHaveBeenCalledWith(
				expect.objectContaining({
					location: vscode.ProgressLocation.Notification,
					title: `Removing credentials for ${CLEAR_URL}`,
					cancellable: true,
				}),
				expect.any(Function),
			);
		});

		it.each([
			{ scenario: "succeeds", error: undefined },
			{ scenario: "fails", error: new Error("unexpected failure") },
			{ scenario: "is cancelled", error: makeAbortError() },
		])("should not throw when deleteToken $scenario", async ({ error }) => {
			const { manager, mockCredManager } = setupCliManager();
			if (error) {
				vi.mocked(mockCredManager.deleteToken).mockRejectedValueOnce(error);
			}
			await expect(manager.clearCredentials(CLEAR_URL)).resolves.not.toThrow();
		});
	});

	describe("Binary Version Validation", () => {
		it("rejects invalid server versions", async () => {
			const { manager, mockApi } = setupCliManager();
			mockApi.getBuildInfo = vi.fn().mockResolvedValue({ version: "invalid" });
			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Got invalid version from deployment",
			);
		});

		it("accepts valid semver versions", async () => {
			const { manager, mockApi, withExistingBinary } = setupCliManager();
			withExistingBinary(TEST_VERSION);
			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
		});
	});

	describe("Existing Binary Handling", () => {
		it("reuses matching binary without downloading", async () => {
			const { manager, mockApi, mockAxios, withExistingBinary } =
				setupCliManager();
			withExistingBinary(TEST_VERSION);
			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
			expect(mockAxios.get).not.toHaveBeenCalled();
			expect(memfs.existsSync(BINARY_PATH)).toBe(true);
		});

		it("downloads when versions differ", async () => {
			const { manager, mockApi, withExistingBinary, withSuccessfulDownload } =
				setupCliManager();
			withExistingBinary("1.0.0");
			withSuccessfulDownload();
			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent(TEST_VERSION),
			);
		});

		it("keeps mismatched binary when downloads disabled", async () => {
			const { manager, mockApi, mockAxios, mockConfig, withExistingBinary } =
				setupCliManager();
			mockConfig.set("coder.enableDownloads", false);
			withExistingBinary("1.0.0");
			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
			expect(mockAxios.get).not.toHaveBeenCalled();
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent("1.0.0"),
			);
		});

		it("downloads fresh binary when corrupted", async () => {
			const { manager, mockApi, withCorruptedBinary, withSuccessfulDownload } =
				setupCliManager();
			withCorruptedBinary();
			withSuccessfulDownload();
			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent(TEST_VERSION),
			);
		});

		it("downloads when no binary exists", async () => {
			const { manager, mockApi, withSuccessfulDownload } = setupCliManager();
			expect(memfs.existsSync(BINARY_DIR)).toBe(false);
			withSuccessfulDownload();

			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
			expect(memfs.existsSync(BINARY_DIR)).toBe(true);
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent(TEST_VERSION),
			);
		});

		it("fails when downloads disabled and no binary", async () => {
			const { manager, mockApi, mockConfig } = setupCliManager();
			mockConfig.set("coder.enableDownloads", false);
			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Unable to download CLI because downloads are disabled",
			);
			expect(memfs.existsSync(BINARY_PATH)).toBe(false);
		});

		it("restores old backup when replace fails", async () => {
			const { manager, mockApi, withExistingBinary, withSuccessfulDownload } =
				setupCliManager();
			withExistingBinary("1.0.0");
			withSuccessfulDownload();

			// Fail the temp → binPath rename to simulate a locked binary.
			// The existing → .old-* rename (no .temp- in source) still succeeds.
			const realRename = memfs.promises.rename.bind(memfs.promises);
			const spy = vi
				.spyOn(memfs.promises, "rename")
				.mockImplementation(async (src, dest) => {
					if (String(src).includes(".temp-")) {
						const err = new Error("EBUSY") as NodeJS.ErrnoException;
						err.code = "EBUSY";
						throw err;
					}
					return realRename(src, dest);
				});

			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
			expect(
				readdir(BINARY_DIR).find((f) => f.includes(".old-")),
			).toBeUndefined();
			spy.mockRestore();
		});
	});

	describe("Binary Download Behavior", () => {
		it("downloads with correct headers", async () => {
			const { manager, mockApi, mockAxios, withSuccessfulDownload } =
				setupCliManager();
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi);
			expect(mockAxios.get).toHaveBeenCalledWith(
				`/bin/${BINARY_NAME}`,
				expect.objectContaining({
					responseType: "stream",
					headers: expect.objectContaining({
						"Accept-Encoding": "identity",
						"If-None-Match": '""',
					}),
				}),
			);
		});

		it("uses custom binary source", async () => {
			const {
				manager,
				mockApi,
				mockAxios,
				mockConfig,
				withSuccessfulDownload,
			} = setupCliManager();
			mockConfig.set("coder.binarySource", "/custom/path");
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi);
			expect(mockAxios.get).toHaveBeenCalledWith(
				"/custom/path",
				expect.objectContaining({
					responseType: "stream",
					decompress: false,
					validateStatus: expect.any(Function),
				}),
			);
		});

		it("uses ETag for existing binaries", async () => {
			const {
				manager,
				mockApi,
				mockAxios,
				withExistingBinary,
				withSuccessfulDownload,
			} = setupCliManager();
			withExistingBinary("1.0.0");
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi);

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
			const { manager, mockApi, withSuccessfulDownload } = setupCliManager();
			// Create old temporary files and signature files matching the binary name
			vol.mkdirSync(BINARY_DIR, { recursive: true });
			memfs.writeFileSync(
				path.join(BINARY_DIR, `${BINARY_NAME}.old-xyz`),
				"old",
			);
			memfs.writeFileSync(
				path.join(BINARY_DIR, `${BINARY_NAME}.temp-abc`),
				"temp",
			);
			memfs.writeFileSync(
				path.join(BINARY_DIR, `${BINARY_NAME}.asc`),
				"signature",
			);
			// Unrelated files should not be removed
			memfs.writeFileSync(path.join(BINARY_DIR, "keeper.txt"), "keep");
			memfs.writeFileSync(path.join(BINARY_DIR, "other.old-xyz"), "keep");

			withSuccessfulDownload();
			await manager.fetchBinary(mockApi);

			expect(
				memfs.existsSync(path.join(BINARY_DIR, `${BINARY_NAME}.old-xyz`)),
			).toBe(false);
			expect(
				memfs.existsSync(path.join(BINARY_DIR, `${BINARY_NAME}.temp-abc`)),
			).toBe(false);
			expect(
				memfs.existsSync(path.join(BINARY_DIR, `${BINARY_NAME}.asc`)),
			).toBe(false);
			expect(memfs.existsSync(path.join(BINARY_DIR, "keeper.txt"))).toBe(true);
			expect(memfs.existsSync(path.join(BINARY_DIR, "other.old-xyz"))).toBe(
				true,
			);
		});

		it("moves existing binary to backup file before writing new version", async () => {
			const { manager, mockApi, withExistingBinary, withSuccessfulDownload } =
				setupCliManager();
			withExistingBinary("1.0.0");
			withSuccessfulDownload();

			await manager.fetchBinary(mockApi);

			// Verify the old binary was backed up
			const backupFile = readdir(BINARY_DIR).find(
				(f) => f.startsWith(BINARY_NAME) && /\.old-[a-z0-9]+$/.exec(f),
			);
			expect(backupFile).toBeDefined();
		});
	});

	describe("Download HTTP Response Handling", () => {
		it("handles 304 Not Modified", async () => {
			const { manager, mockApi, withExistingBinary, withHttpResponse } =
				setupCliManager();
			withExistingBinary("1.0.0");
			withHttpResponse(304);
			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent("1.0.0"),
			);
		});

		it("handles 404 platform not supported", async () => {
			const { manager, mockApi, mockUI, withHttpResponse } = setupCliManager();
			withHttpResponse(404);
			mockUI.setResponse(
				"Coder isn't supported for your platform. Please open an issue, we'd love to support it!",
				"Open an Issue",
			);
			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
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
			const { manager, mockApi, mockUI, withHttpResponse } = setupCliManager();
			withHttpResponse(500);
			mockUI.setResponse(
				"Failed to download binary. Please open an issue.",
				"Open an Issue",
			);
			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
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
		it("handles write stream errors", async () => {
			const { manager, mockApi, withStreamError } = setupCliManager();
			withStreamError("write", "disk full");
			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Unable to download binary: disk full",
			);
			expect(memfs.existsSync(BINARY_PATH)).toBe(false);
		});

		it("handles read stream errors", async () => {
			const { manager, mockApi, withStreamError } = setupCliManager();
			withStreamError("read", "network timeout");
			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Unable to download binary: network timeout",
			);
			expect(memfs.existsSync(BINARY_PATH)).toBe(false);
		});

		it("handles missing content-length", async () => {
			const { manager, mockApi, mockProgress, withSuccessfulDownload } =
				setupCliManager();
			withSuccessfulDownload({ headers: {} });
			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
			const reports = mockProgress.getProgressReports();
			expect(reports).not.toHaveLength(0);
			for (const report of reports) {
				expect(report).toMatchObject({ increment: undefined });
			}
		});

		it.each(["content-length", "x-original-content-length"])(
			"reports progress with %s header",
			async (header) => {
				const { manager, mockApi, mockProgress, withSuccessfulDownload } =
					setupCliManager();
				withSuccessfulDownload({ headers: { [header]: "1024" } });
				expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
				const reports = mockProgress.getProgressReports();
				expect(reports).not.toHaveLength(0);
				for (const report of reports) {
					expect(report).toMatchObject({ increment: expect.any(Number) });
				}
			},
		);
	});

	describe("Download Progress Tracking", () => {
		it("shows download progress", async () => {
			const { manager, mockApi, withSuccessfulDownload } = setupCliManager();
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi);
			expect(vscode.window.withProgress).toHaveBeenCalledWith(
				expect.objectContaining({
					title: `Downloading Coder CLI for ${TEST_URL}`,
				}),
				expect.any(Function),
			);
		});

		it("handles user cancellation", async () => {
			const { manager, mockApi, mockProgress, withSuccessfulDownload } =
				setupCliManager();
			mockProgress.setCancellation(true);
			withSuccessfulDownload();
			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Download aborted",
			);
			expect(memfs.existsSync(BINARY_PATH)).toBe(false);
		});
	});

	describe("Binary Signature Verification", () => {
		/** A download with signature verification enabled. */
		function setupVerify(): CliManagerHarness {
			const t = setupCliManager();
			t.mockConfig.set("coder.disableSignatureVerification", false);
			t.withSuccessfulDownload();
			return t;
		}

		it("verifies valid signatures", async () => {
			const t = setupVerify();
			t.withSignatureResponses([200]);
			expectPathsEqual(await t.manager.fetchBinary(t.mockApi), BINARY_PATH);
			expect(pgp.verifySignature).toHaveBeenCalled();
			expect(expectFileInDir(BINARY_DIR, ".asc")).toBeDefined();
		});

		it("tries fallback signature on 404", async () => {
			const t = setupVerify();
			t.withSignatureResponses([404, 200]);
			t.mockUI.setResponse("Signature not found", "Download signature");
			expectPathsEqual(await t.manager.fetchBinary(t.mockApi), BINARY_PATH);
			expect(t.mockAxios.get).toHaveBeenCalledTimes(3);
			expect(expectFileInDir(BINARY_DIR, ".asc")).toBeDefined();
		});

		it("allows running despite invalid signature", async () => {
			const t = setupVerify();
			t.withSignatureResponses([200]);
			t.withInvalidSignature();
			t.mockUI.setResponse("Signature does not match", "Run anyway");
			expectPathsEqual(await t.manager.fetchBinary(t.mockApi), BINARY_PATH);
		});

		it("aborts on signature rejection", async () => {
			const t = setupVerify();
			t.withSignatureResponses([200]);
			t.withInvalidSignature();
			t.mockUI.setResponse("Signature does not match", undefined);
			await expect(t.manager.fetchBinary(t.mockApi)).rejects.toThrow(
				"Signature verification aborted",
			);
		});

		it("skips verification when disabled", async () => {
			const { manager, mockApi, mockConfig, withSuccessfulDownload } =
				setupCliManager();
			mockConfig.set("coder.disableSignatureVerification", true);
			withSuccessfulDownload();
			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);
			expect(pgp.verifySignature).not.toHaveBeenCalled();
		});

		type SignatureErrorTestCase = [status: number, message: string];
		it.each<SignatureErrorTestCase>([
			[404, "Signature not found"],
			[500, "Failed to download signature"],
		])("allows skipping verification on %i", async (status, message) => {
			const t = setupVerify();
			t.withHttpResponse(status);
			t.mockUI.setResponse(message, "Run without verification");
			expectPathsEqual(await t.manager.fetchBinary(t.mockApi), BINARY_PATH);
			expect(pgp.verifySignature).not.toHaveBeenCalled();
		});

		it.each<SignatureErrorTestCase>([
			[404, "Signature not found"],
			[500, "Failed to download signature"],
		])(
			"aborts when user declines missing signature on %i",
			async (status, message) => {
				const t = setupVerify();
				t.withHttpResponse(status);
				t.mockUI.setResponse(message, undefined); // User cancels
				await expect(t.manager.fetchBinary(t.mockApi)).rejects.toThrow(
					"Signature download aborted",
				);
			},
		);
	});

	describe("File System Operations", () => {
		it("creates binary directory", async () => {
			const { manager, mockApi, withSuccessfulDownload } = setupCliManager();
			expect(memfs.existsSync(BINARY_DIR)).toBe(false);
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi);
			expect(memfs.statSync(BINARY_DIR).isDirectory()).toBe(true);
		});

		it("validates downloaded binary version", async () => {
			const { manager, mockApi, withSuccessfulDownload } = setupCliManager();
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi);
			expect(memfs.readFileSync(BINARY_PATH).toString()).toBe(
				mockBinaryContent(TEST_VERSION),
			);
		});

		it("sets correct file permissions", async () => {
			const { manager, mockApi, withSuccessfulDownload } = setupCliManager();
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi);
			expect(memfs.statSync(BINARY_PATH).mode & 0o777).toBe(0o755);
		});
	});

	describe("Path Pecularities", () => {
		it("handles binary with spaces in path", async () => {
			const pathWithSpaces = "/path with spaces";
			const { manager, mockApi, withSuccessfulDownload } =
				setupCliManager(pathWithSpaces);

			withSuccessfulDownload();
			expectPathsEqual(
				await manager.fetchBinary(mockApi),
				`${pathWithSpaces}/test.coder.com/bin/${BINARY_NAME}`,
			);
		});
	});
});
