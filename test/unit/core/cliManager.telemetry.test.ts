import globalAxios, { type AxiosInstance } from "axios";
import { type Api } from "coder/site/src/api/api";
import { fs as memfs, vol } from "memfs";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cliExec from "@/core/cliExec";
import { CliManager } from "@/core/cliManager";
import { PathResolver } from "@/core/pathResolver";
import * as pgp from "@/pgp";

import { createTestTelemetryService, TestSink } from "../../mocks/telemetry";
import {
	createMockCliCredentialManager,
	createMockLogger,
	createMockStream,
	MockConfigurationProvider,
	MockProgressReporter,
	MockUserInteraction,
} from "../../mocks/testHelpers";
import { expectPathsEqual } from "../../utils/platform";

import type * as fs from "node:fs";

import type { CliCredentialManager } from "@/core/cliCredentialManager";

vi.mock("os");
vi.mock("axios");

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

vi.mock("proper-lockfile", () => ({
	lock: () => Promise.resolve(() => Promise.resolve()),
	check: () => Promise.resolve(false),
}));

vi.mock("@/pgp");

vi.mock("@/core/cliExec", async () => {
	const actual =
		await vi.importActual<typeof import("@/core/cliExec")>("@/core/cliExec");
	return {
		...actual,
		version: vi.fn(),
	};
});

describe("CliManager telemetry", () => {
	let manager: CliManager;
	let mockConfig: MockConfigurationProvider;
	let mockProgress: MockProgressReporter;
	let mockUI: MockUserInteraction;
	let mockApi: Api;
	let mockAxios: AxiosInstance;
	let mockCredManager: CliCredentialManager;
	let telemetrySink: TestSink;

	const TEST_VERSION = "1.2.3";
	const TEST_URL = "https://test.coder.com";
	const BASE_PATH = "/path/base";
	const BINARY_DIR = `${BASE_PATH}/test.coder.com/bin`;
	const PLATFORM = "linux";
	const ARCH = "amd64";
	const BINARY_NAME = `coder-${PLATFORM}-${ARCH}`;
	const BINARY_PATH = `${BINARY_DIR}/${BINARY_NAME}`;

	beforeEach(() => {
		vi.resetAllMocks();
		vol.reset();

		mockApi = createMockApi(TEST_VERSION, TEST_URL);
		mockAxios = mockApi.getAxiosInstance();
		vi.mocked(globalAxios.create).mockReturnValue(mockAxios);
		mockConfig = new MockConfigurationProvider();
		mockProgress = new MockProgressReporter();
		mockUI = new MockUserInteraction();
		mockCredManager = createMockCliCredentialManager();
		telemetrySink = new TestSink();
		manager = new CliManager(
			createMockLogger(),
			new PathResolver(BASE_PATH, "/code/log"),
			mockCredManager,
			createTestTelemetryService(telemetrySink),
		);

		vi.mocked(os.platform).mockReturnValue(PLATFORM);
		vi.mocked(os.arch).mockReturnValue(ARCH);
		vi.mocked(pgp.readPublicKeys).mockResolvedValue([]);

		mockConfig.set("coder.disableSignatureVerification", true);
	});

	afterEach(async () => {
		mockProgress?.setCancellation(false);
		vi.clearAllTimers();
		await new Promise((resolve) => setImmediate(resolve));
		vol.reset();
	});

	describe("cli.configure", () => {
		const CONFIGURE_URL = "https://coder.example.com";
		const TOKEN = "test-token";

		const configureEvent = () => telemetrySink.expectOne("cli.configure");

		function configure(options?: { silent?: boolean }) {
			return manager.configure(CONFIGURE_URL, TOKEN, options);
		}

		it("emits credential source and silent mode on success", async () => {
			await configure();

			expect(configureEvent()).toMatchObject({
				properties: {
					result: "success",
					silent: "false",
					credential_source: "session_token",
				},
				measurements: { durationMs: expect.any(Number) },
			});
		});

		it("emits silent=true when progress is suppressed", async () => {
			await configure({ silent: true });

			expect(configureEvent().properties).toMatchObject({
				result: "success",
				silent: "true",
				credential_source: "session_token",
			});
		});

		it("reports empty token as the mTLS credential source", async () => {
			await manager.configure(CONFIGURE_URL, "");

			expect(configureEvent().properties).toMatchObject({
				credential_source: "empty_token",
			});
		});

		it.each([{ silent: false }, { silent: true }])(
			"emits credential_store failure category on failure (silent=$silent)",
			async (options) => {
				vi.mocked(mockCredManager.storeToken).mockRejectedValueOnce(
					new Error("keyring unavailable"),
				);

				await expect(configure(options)).rejects.toThrow("keyring unavailable");
				expect(configureEvent()).toMatchObject({
					properties: {
						result: "error",
						failure_category: "credential_store",
					},
					error: { message: "keyring unavailable" },
				});
			},
		);

		it("emits cancelled failure category when user cancels", async () => {
			const error = new Error("The operation was aborted");
			error.name = "AbortError";
			vi.mocked(mockCredManager.storeToken).mockRejectedValueOnce(error);

			await expect(configure()).resolves.not.toThrow();
			expect(configureEvent().properties).toMatchObject({
				result: "aborted",
				failure_category: "cancelled",
			});
		});
	});

	describe("cli.resolve and cli.download", () => {
		const event = (name: string) =>
			telemetrySink.events.find((e) => e.eventName === name);

		it.each([
			{ reason: "missing", setup: () => {} },
			{ reason: "version_mismatch", setup: () => withExistingBinary("1.0.0") },
			{ reason: "unreadable", setup: () => withCorruptedBinary() },
		])("emits cli.download with reason=$reason", async ({ reason, setup }) => {
			setup();
			withSuccessfulDownload();
			await manager.fetchBinary(mockApi);

			const e = event("cli.download");
			expect(e).toMatchObject({
				properties: { reason, result: "success" },
			});
			expect(e?.measurements.durationMs).toBeGreaterThanOrEqual(0);
			expect(e?.measurements.downloaded_bytes).toBe(
				Buffer.byteLength(mockBinaryContent(TEST_VERSION)),
			);
		});

		it("emits cli.resolve cache-hit phases without cli.download", async () => {
			withExistingBinary(TEST_VERSION);
			await manager.fetchBinary(mockApi);

			expect(event("cli.download")).toBeUndefined();
			expect(event("cli.resolve")).toMatchObject({
				properties: {
					result: "success",
					outcome: "cache_hit",
					cache_source: "directory",
					version_check: "match",
				},
				measurements: { durationMs: expect.any(Number) },
			});
			expect(event("cli.resolve.cache_lookup")).toMatchObject({
				properties: { source: "directory", result: "success" },
			});
			expect(event("cli.resolve.version_check")).toMatchObject({
				properties: { outcome: "match", result: "success" },
			});
		});

		it("distinguishes disabled-download fallback", async () => {
			mockConfig.set("coder.enableDownloads", false);
			withExistingBinary("1.0.0");

			expectPathsEqual(await manager.fetchBinary(mockApi), BINARY_PATH);

			expect(event("cli.download")).toBeUndefined();
			expect(event("cli.resolve.download_decision")).toMatchObject({
				properties: {
					reason: "version_mismatch",
					outcome: "fallback",
					result: "success",
				},
			});
			expect(event("cli.resolve")).toMatchObject({
				properties: {
					outcome: "download_disabled_fallback",
					result: "success",
				},
			});
		});

		it("distinguishes disabled-download failure", async () => {
			mockConfig.set("coder.enableDownloads", false);

			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Unable to download CLI because downloads are disabled",
			);

			expect(event("cli.download")).toBeUndefined();
			expect(event("cli.resolve")).toMatchObject({
				properties: {
					failure_category: "downloads_disabled",
					result: "error",
				},
			});
		});

		it("distinguishes fallback declined from download failure", async () => {
			withExistingBinary("1.0.0");
			vi.mocked(cliExec.version).mockResolvedValueOnce("1.0.0");
			withHttpResponse(
				200,
				{ "content-length": "1024" },
				createMockStream("partial-binary", {
					error: new Error("connection reset"),
				}),
			);
			mockUI.setResponse(
				"Failed to update CLI binary. Run version 1.0.0 anyway?",
				undefined,
			);

			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Unable to download binary: connection reset",
			);

			expect(event("cli.resolve.fallback_to_existing_binary")).toMatchObject({
				properties: { failure_category: "fallback_declined", result: "error" },
			});
		});

		it("omits downloaded_bytes when the server returns 304", async () => {
			withExistingBinary("1.0.0");
			withHttpResponse(304);
			await manager.fetchBinary(mockApi);

			const e = event("cli.download");
			expect(e).toMatchObject({
				properties: { reason: "version_mismatch", result: "success" },
			});
			expect(e?.measurements.downloaded_bytes).toBeUndefined();
			expect(event("cli.resolve")).toMatchObject({
				properties: { outcome: "downloaded", result: "success" },
			});
		});

		it("emits downloaded_bytes when a download fails mid-stream", async () => {
			const partial = "partial-binary";
			withHttpResponse(
				200,
				{ "content-length": "1024" },
				createMockStream(partial, { error: new Error("connection reset") }),
			);

			await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
				"Unable to download binary: connection reset",
			);

			expect(event("cli.download")).toMatchObject({
				properties: { reason: "missing", result: "error" },
				error: { message: "Unable to download binary: connection reset" },
				measurements: { downloaded_bytes: Buffer.byteLength(partial) },
			});
			expect(event("cli.resolve.fallback_to_existing_binary")).toMatchObject({
				properties: { failure_category: "download", result: "error" },
			});
			expect(event("cli.resolve")).toMatchObject({
				properties: { result: "error" },
			});
		});

		describe("cli.download.verify", () => {
			beforeEach(() => {
				mockConfig.set("coder.disableSignatureVerification", false);
				withSuccessfulDownload();
			});

			it("emits outcome=verified on valid signature", async () => {
				withSignatureResponses([200]);
				await manager.fetchBinary(mockApi);

				const verify = event("cli.download.verify");
				const download = event("cli.download");
				expect(verify).toMatchObject({
					properties: { outcome: "verified", result: "success" },
				});
				expect(verify?.measurements.durationMs).toBeGreaterThanOrEqual(0);
				expect(verify?.traceId).toBe(download?.traceId);
				expect(verify?.parentEventId).toBe(download?.eventId);
			});

			it("emits outcome=bypassed when user runs anyway despite invalid signature", async () => {
				withSignatureResponses([200]);
				vi.mocked(pgp.verifySignature).mockRejectedValueOnce(
					createVerificationError("Invalid signature"),
				);
				mockUI.setResponse("Signature does not match", "Run anyway");

				await manager.fetchBinary(mockApi);

				expect(event("cli.download.verify")).toMatchObject({
					properties: { outcome: "bypassed", result: "success" },
				});
			});

			it.each([
				{ status: 404, message: "Signature not found" },
				{ status: 500, message: "Failed to download signature" },
			])(
				"emits outcome=sig_not_found with sig_status=$status when user runs without verification",
				async ({ status, message }) => {
					withSignatureResponses([status, status]);
					mockUI.setResponse(message, "Run without verification");

					await manager.fetchBinary(mockApi);

					expect(event("cli.download.verify")).toMatchObject({
						properties: {
							outcome: "sig_not_found",
							sig_status: String(status),
							result: "success",
						},
					});
				},
			);

			it("emits error when verification is aborted", async () => {
				withSignatureResponses([200]);
				vi.mocked(pgp.verifySignature).mockRejectedValueOnce(
					createVerificationError("Invalid signature"),
				);
				mockUI.setResponse("Signature does not match", undefined);

				await expect(manager.fetchBinary(mockApi)).rejects.toThrow(
					"Signature verification aborted",
				);

				expect(event("cli.download.verify")).toMatchObject({
					properties: { result: "error" },
					error: { message: "Signature verification aborted" },
				});
			});
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
		vi.mocked(cliExec.version).mockResolvedValueOnce(version);
	}

	function withCorruptedBinary() {
		vol.mkdirSync(BINARY_DIR, { recursive: true });
		memfs.writeFileSync(BINARY_PATH, "corrupted-binary-content", {
			mode: 0o755,
		});
		vi.mocked(cliExec.version).mockRejectedValueOnce(new Error("corrupted"));
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
		vi.mocked(cliExec.version).mockResolvedValue(TEST_VERSION);
	}

	function withSignatureResponses(statuses: number[]): void {
		for (const status of statuses) {
			const data =
				status === 200 ? createMockStream("mock-signature-content") : undefined;
			withHttpResponse(status, {}, data);
		}
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
});

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
