import globalAxios, { type AxiosInstance } from "axios";
import { type Api } from "coder/site/src/api/api";
import { fs as memfs, vol } from "memfs";
import EventEmitter from "node:events";
import * as fs from "node:fs";
import { type IncomingMessage } from "node:http";
import * as os from "node:os";
import { expect, vi } from "vitest";

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

export const TEST_VERSION = "1.2.3";
export const TEST_URL = "https://test.coder.com";
export const BASE_PATH = "/path/base";
export const BINARY_DIR = `${BASE_PATH}/test.coder.com/bin`;
export const PLATFORM = "linux";
export const ARCH = "amd64";
export const BINARY_NAME = `coder-${PLATFORM}-${ARCH}`;
export const BINARY_PATH = `${BINARY_DIR}/${BINARY_NAME}`;

export type CliManagerHarness = ReturnType<typeof setupCliManager>;

/**
 * Build a fresh `CliManager` against memfs and mocked collaborators. Call once
 * per test and destructure what you need; the builders close over this instance.
 */
export function setupCliManager(basePath: string = BASE_PATH) {
	vi.resetAllMocks();
	vol.reset();

	const telemetrySink = new TestSink();
	const mockApi = createMockApi(TEST_VERSION, TEST_URL);
	const mockAxios = mockApi.getAxiosInstance();
	vi.mocked(globalAxios.create).mockReturnValue(mockAxios);

	const mockConfig = new MockConfigurationProvider();
	const mockProgress = new MockProgressReporter();
	const mockUI = new MockUserInteraction();
	const mockCredManager = createMockCliCredentialManager();
	const manager = new CliManager(
		createMockLogger(),
		new PathResolver(basePath, "/code/log"),
		mockCredManager,
		createTestTelemetryService(telemetrySink),
	);

	vi.mocked(os.platform).mockReturnValue(PLATFORM);
	vi.mocked(os.arch).mockReturnValue(ARCH);
	vi.mocked(pgp.readPublicKeys).mockResolvedValue([]);
	mockConfig.set("coder.disableSignatureVerification", true);

	/** Queue the next axios GET to resolve with this response. */
	const withHttpResponse = (
		status: number,
		headers: Record<string, unknown> = {},
		data?: unknown,
	) =>
		vi.mocked(mockAxios.get).mockResolvedValueOnce({ status, headers, data });

	/** Queue the next CLI version read to resolve `version`. */
	const withBinaryVersion = (version: string) =>
		vi.mocked(cliExec.version).mockResolvedValueOnce(version);

	/** Place a readable binary of `version` in `dir`. */
	const withExistingBinary = (version: string, dir: string = BINARY_DIR) => {
		vol.mkdirSync(dir, { recursive: true });
		memfs.writeFileSync(`${dir}/${BINARY_NAME}`, mockBinaryContent(version), {
			mode: 0o755,
		});
		withBinaryVersion(version);
	};

	/** Place a cached binary whose version cannot be read. */
	const withCorruptedBinary = () => {
		vol.mkdirSync(BINARY_DIR, { recursive: true });
		memfs.writeFileSync(BINARY_PATH, "corrupted-binary-content", {
			mode: 0o755,
		});
		vi.mocked(cliExec.version).mockRejectedValueOnce(new Error("corrupted"));
	};

	/** Serve a complete binary download that verifies as `TEST_VERSION`. */
	const withSuccessfulDownload = (opts?: {
		headers?: Record<string, unknown>;
	}) => {
		withHttpResponse(
			200,
			opts?.headers ?? { "content-length": "1024" },
			createMockStream(mockBinaryContent(TEST_VERSION)),
		);
		vi.mocked(cliExec.version).mockResolvedValue(TEST_VERSION);
	};

	/** Serve a download that errors mid-stream after `partial` bytes. */
	const withInterruptedDownload = (partial = "partial-binary") =>
		withHttpResponse(
			200,
			{ "content-length": "1024" },
			createMockStream(partial, { error: new Error("connection reset") }),
		);

	/** Queue one HTTP response per signature source status. */
	const withSignatureResponses = (statuses: number[]) => {
		for (const status of statuses) {
			const data =
				status === 200 ? createMockStream("mock-signature-content") : undefined;
			withHttpResponse(status, {}, data);
		}
	};

	/** Make the next signature verification reject as invalid. */
	const withInvalidSignature = () =>
		vi
			.mocked(pgp.verifySignature)
			.mockRejectedValueOnce(createVerificationError("Invalid signature"));

	/** Fail the download via a read- or write-stream error. */
	const withStreamError = (type: "read" | "write", message: string) => {
		if (type === "write") {
			vi.spyOn(fs, "createWriteStream").mockImplementation(() => {
				const stream = new EventEmitter();
				(stream as unknown as fs.WriteStream).write = vi.fn();
				(stream as unknown as fs.WriteStream).close = vi.fn();
				setImmediate(() => stream.emit("error", new Error(message)));
				return stream as ReturnType<typeof memfs.createWriteStream>;
			});
			withHttpResponse(
				200,
				{ "content-length": "256" },
				createMockStream("data"),
			);
			return;
		}
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
	};

	/** The single event named `name`, asserting exactly one was emitted. */
	const event = (name: string) => telemetrySink.expectOne(name);
	/** Asserts no event named `name` was emitted. */
	const noEvent = (name: string) =>
		expect(telemetrySink.eventsNamed(name)).toHaveLength(0);
	/** Asserts the single event named `name` carries (at least) `properties`. */
	const expectProps = (name: string, properties: Record<string, string>) =>
		expect(event(name).properties).toMatchObject(properties);

	return {
		manager,
		mockConfig,
		mockProgress,
		mockUI,
		mockApi,
		mockAxios,
		mockCredManager,
		telemetrySink,
		withHttpResponse,
		withBinaryVersion,
		withExistingBinary,
		withCorruptedBinary,
		withSuccessfulDownload,
		withInterruptedDownload,
		withSignatureResponses,
		withInvalidSignature,
		withStreamError,
		event,
		noEvent,
		expectProps,
	};
}

/** Drain memfs's internally-scheduled FS operations between tests. */
export async function flushPendingIO(): Promise<void> {
	vi.clearAllTimers();
	await new Promise((resolve) => setImmediate(resolve));
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

export function mockBinaryContent(version: string): string {
	return `mock-binary-v${version}`;
}

export function makeAbortError(): Error {
	const error = new Error("The operation was aborted");
	error.name = "AbortError";
	return error;
}

function createVerificationError(msg: string): pgp.VerificationError {
	const error = new pgp.VerificationError(
		pgp.VerificationErrorCode.Invalid,
		msg,
	);
	vi.mocked(error.summary).mockReturnValue("Signature does not match");
	return error;
}

export function readdir(dir: string): string[] {
	return memfs.readdirSync(dir) as string[];
}

export function expectFileInDir(
	dir: string,
	pattern: string,
): string | undefined {
	return readdir(dir).find((f) => f.includes(pattern));
}
