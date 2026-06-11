import { afterEach, describe, expect, it, vi } from "vitest";

import { expectPathsEqual } from "../../utils/platform";

import {
	BINARY_PATH,
	type CliManagerHarness,
	flushPendingIO,
	makeAbortError,
	mockBinaryContent,
	setupCliManager,
	TEST_VERSION,
} from "./cliManagerHarness";

import type * as fs from "node:fs";

vi.mock("os");
vi.mock("axios");

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

describe("CliManager telemetry", () => {
	afterEach(flushPendingIO);

	describe("cli.configure", () => {
		const URL = "https://coder.example.com";
		const TOKEN = "test-token";

		it.each([
			{
				name: "session token",
				token: TOKEN,
				options: undefined,
				props: { silent: "false", credential_source: "session_token" },
			},
			{
				name: "silent mode",
				token: TOKEN,
				options: { silent: true },
				props: { silent: "true", credential_source: "session_token" },
			},
			{
				name: "empty token as mTLS",
				token: "",
				options: undefined,
				props: { credential_source: "empty_token" },
			},
		])("emits $name on success", async ({ token, options, props }) => {
			const { manager, event } = setupCliManager();

			await manager.configure(URL, token, options);

			expect(event("cli.configure")).toMatchObject({
				properties: { result: "success", ...props },
				measurements: { durationMs: expect.any(Number) },
			});
		});

		it.each([{ silent: false }, { silent: true }])(
			"emits credential_store error type on failure (silent=$silent)",
			async ({ silent }) => {
				const { manager, mockCredManager, event } = setupCliManager();
				vi.mocked(mockCredManager.storeToken).mockRejectedValueOnce(
					new Error("keyring unavailable"),
				);

				await expect(manager.configure(URL, TOKEN, { silent })).rejects.toThrow(
					"keyring unavailable",
				);
				expect(event("cli.configure")).toMatchObject({
					properties: { result: "error", "error.type": "credential_store" },
					error: { message: "keyring unavailable" },
				});
			},
		);

		it("aborts with a stage when the user cancels", async () => {
			const { manager, mockCredManager, expectProps } = setupCliManager();
			vi.mocked(mockCredManager.storeToken).mockRejectedValueOnce(
				makeAbortError(),
			);

			await expect(manager.configure(URL, TOKEN)).resolves.not.toThrow();
			expectProps("cli.configure", {
				result: "aborted",
				abort_stage: "credential_store",
			});
		});
	});

	describe("cli.resolve and cli.download", () => {
		const prepare: Record<string, (t: CliManagerHarness) => void> = {
			missing: () => {},
			version_mismatch: (t) => t.withExistingBinary("1.0.0"),
			unreadable: (t) => t.withCorruptedBinary(),
		};

		it.each(["missing", "version_mismatch", "unreadable"])(
			"emits cli.download with reason=%s",
			async (reason) => {
				const t = setupCliManager();
				prepare[reason](t);
				t.withSuccessfulDownload();

				await t.manager.fetchBinary(t.mockApi);

				t.expectProps("cli.download", { reason, result: "success" });
				expect(t.event("cli.download").measurements).toMatchObject({
					durationMs: expect.any(Number),
					downloaded_bytes: Buffer.byteLength(mockBinaryContent(TEST_VERSION)),
				});
			},
		);

		it("emits cli.resolve cache-hit phases without cli.download", async () => {
			const {
				manager,
				mockApi,
				event,
				noEvent,
				expectProps,
				withExistingBinary,
			} = setupCliManager();
			withExistingBinary(TEST_VERSION);

			await manager.fetchBinary(mockApi);

			noEvent("cli.download");
			expect(event("cli.resolve")).toMatchObject({
				properties: {
					result: "success",
					outcome: "cache_hit",
					cache_source: "directory",
					version_check: "match",
				},
				measurements: { durationMs: expect.any(Number) },
			});
			expectProps("cli.resolve.cache_lookup", {
				source: "directory",
				result: "success",
			});
			expectProps("cli.resolve.version_check", {
				outcome: "match",
				result: "success",
			});
		});

		it("distinguishes disabled-download fallback", async () => {
			const {
				manager,
				mockApi,
				mockConfig,
				noEvent,
				expectProps,
				withExistingBinary,
			} = setupCliManager();
			mockConfig.set("coder.enableDownloads", false);
			withExistingBinary("1.0.0");

			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);

			noEvent("cli.download");
			expectProps("cli.resolve", {
				download_reason: "version_mismatch",
				download_action: "fallback",
				outcome: "download_disabled_fallback",
				result: "success",
			});
		});

		it("distinguishes disabled-download failure", async () => {
			const { manager, mockApi, mockConfig, noEvent, expectProps } =
				setupCliManager();
			mockConfig.set("coder.enableDownloads", false);

			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Unable to download CLI because downloads are disabled",
			);

			noEvent("cli.download");
			expectProps("cli.resolve", {
				"error.type": "downloads_disabled",
				result: "error",
			});
		});

		it("distinguishes fallback declined from download failure", async () => {
			const {
				manager,
				mockApi,
				mockUI,
				expectProps,
				withBinaryVersion,
				withExistingBinary,
				withInterruptedDownload,
			} = setupCliManager();
			withExistingBinary("1.0.0");
			withBinaryVersion("1.0.0"); // fallback re-reads the existing binary
			withInterruptedDownload();
			mockUI.setResponse(
				"Failed to update CLI binary. Run version 1.0.0 anyway?",
				undefined,
			);

			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Unable to download binary: connection reset",
			);

			expectProps("cli.resolve.fallback_to_existing_binary", {
				"error.type": "fallback_declined",
				result: "error",
			});
			expectProps("cli.resolve", {
				fallback_reason: "download",
				"error.type": "fallback_declined",
				result: "error",
			});
		});

		it("omits downloaded_bytes when the server returns 304", async () => {
			const {
				manager,
				mockApi,
				event,
				expectProps,
				withExistingBinary,
				withHttpResponse,
			} = setupCliManager();
			withExistingBinary("1.0.0");
			withHttpResponse(304);

			await manager.fetchBinary(mockApi);

			expectProps("cli.download", {
				reason: "version_mismatch",
				result: "success",
			});
			expect(
				event("cli.download").measurements.downloaded_bytes,
			).toBeUndefined();
			expectProps("cli.resolve", { outcome: "downloaded", result: "success" });
		});

		it("emits downloaded_bytes when a download fails mid-stream", async () => {
			const { manager, mockApi, event, expectProps, withInterruptedDownload } =
				setupCliManager();
			const partial = "partial-binary";
			withInterruptedDownload(partial);

			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Unable to download binary: connection reset",
			);

			expect(event("cli.download")).toMatchObject({
				properties: { reason: "missing", result: "error" },
				error: { message: "Unable to download binary: connection reset" },
				measurements: { downloaded_bytes: Buffer.byteLength(partial) },
			});
			expectProps("cli.resolve.fallback_to_existing_binary", {
				"error.type": "download",
				result: "error",
			});
			expectProps("cli.resolve", {
				fallback_reason: "download",
				"error.type": "download",
				result: "error",
			});
		});

		describe("cli.download.verify", () => {
			/** A signature-verifying download, ready for the first GET to be queued. */
			function setupVerify(): CliManagerHarness {
				const t = setupCliManager();
				t.mockConfig.set("coder.disableSignatureVerification", false);
				t.withSuccessfulDownload();
				return t;
			}

			it("emits outcome=verified on valid signature", async () => {
				const t = setupVerify();
				t.withSignatureResponses([200]);

				await t.manager.fetchBinary(t.mockApi);

				const verify = t.event("cli.download.verify");
				const download = t.event("cli.download");
				expect(verify).toMatchObject({
					properties: { outcome: "verified", result: "success" },
				});
				expect(verify.measurements.durationMs).toBeGreaterThanOrEqual(0);
				expect(verify.traceId).toBe(download.traceId);
				expect(verify.parentEventId).toBe(download.eventId);
			});

			it("emits outcome=bypassed when user runs anyway despite invalid signature", async () => {
				const t = setupVerify();
				t.withSignatureResponses([200]);
				t.withInvalidSignature();
				t.mockUI.setResponse("Signature does not match", "Run anyway");

				await t.manager.fetchBinary(t.mockApi);

				t.expectProps("cli.download.verify", {
					outcome: "bypassed",
					result: "success",
				});
			});

			it.each([
				{ status: 404, message: "Signature not found" },
				{ status: 500, message: "Failed to download signature" },
			])(
				"emits outcome=sig_not_found with sig_status=$status when user runs without verification",
				async ({ status, message }) => {
					const t = setupVerify();
					t.withSignatureResponses([status, status]);
					t.mockUI.setResponse(message, "Run without verification");

					await t.manager.fetchBinary(t.mockApi);

					t.expectProps("cli.download.verify", {
						outcome: "sig_not_found",
						sig_status: String(status),
						result: "success",
					});
				},
			);

			it("emits error when verification is aborted", async () => {
				const t = setupVerify();
				t.withSignatureResponses([200]);
				t.withInvalidSignature();
				t.mockUI.setResponse("Signature does not match", undefined);

				await expect(t.manager.fetchBinary(t.mockApi)).rejects.toThrow(
					"Signature verification aborted",
				);

				expect(t.event("cli.download.verify")).toMatchObject({
					properties: { result: "error" },
					error: { message: "Signature verification aborted" },
				});
			});
		});
	});
});
