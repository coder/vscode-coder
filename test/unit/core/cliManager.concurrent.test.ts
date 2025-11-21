/**
 * This file tests that multiple concurrent calls to fetchBinary properly coordinate
 * using proper-lockfile to prevent race conditions. Unlike the main cliManager.test.ts,
 * this test uses the real filesystem and doesn't mock the locking library to verify
 * actual file-level coordination.
 */
import { type AxiosInstance } from "axios";
import { type Api } from "coder/site/src/api/api";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { CliManager } from "@/core/cliManager";
import * as cliUtils from "@/core/cliUtils";
import { PathResolver } from "@/core/pathResolver";
import * as pgp from "@/pgp";

import {
	createMockLogger,
	createMockStream,
	MockConfigurationProvider,
	MockProgressReporter,
} from "../../mocks/testHelpers";

vi.mock("@/pgp");
vi.mock("@/core/cliUtils", async () => {
	const actual = await vi.importActual<typeof cliUtils>("@/core/cliUtils");
	return {
		...actual,
		goos: vi.fn(),
		goarch: vi.fn(),
		name: vi.fn(),
		version: vi.fn(),
	};
});

function setupCliUtilsMocks(version: string) {
	vi.mocked(cliUtils.goos).mockReturnValue("linux");
	vi.mocked(cliUtils.goarch).mockReturnValue("amd64");
	vi.mocked(cliUtils.name).mockReturnValue("coder-linux-amd64");
	vi.mocked(cliUtils.version).mockResolvedValue(version);
	vi.mocked(pgp.readPublicKeys).mockResolvedValue([]);
}

function createMockApi(
	version: string,
	options: {
		chunkSize?: number;
		delay?: number;
		error?: NodeJS.ErrnoException;
	} = {},
): Api {
	const mockAxios = {
		get: vi.fn().mockImplementation(() =>
			Promise.resolve({
				status: 200,
				headers: { "content-length": "17" },
				data: createMockStream(`mock-binary-v${version}`, options),
			}),
		),
		defaults: { baseURL: "https://test.coder.com" },
	} as unknown as AxiosInstance;

	return {
		getAxiosInstance: () => mockAxios,
		getBuildInfo: vi.fn().mockResolvedValue({ version }),
	} as unknown as Api;
}

function setupManager(testDir: string): CliManager {
	const _mockProgress = new MockProgressReporter();
	const mockConfig = new MockConfigurationProvider();
	mockConfig.set("coder.disableSignatureVerification", true);

	return new CliManager(
		vscode,
		createMockLogger(),
		new PathResolver(testDir, "/code/log"),
	);
}

describe("CliManager Concurrent Downloads", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "climanager-concurrent-"),
		);
	});

	afterEach(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("handles multiple concurrent downloads without race conditions", async () => {
		const manager = setupManager(testDir);
		setupCliUtilsMocks("1.2.3");
		const mockApi = createMockApi("1.2.3");

		const label = "test.coder.com";
		const binaryPath = path.join(testDir, label, "bin", "coder-linux-amd64");

		const downloads = await Promise.all([
			manager.fetchBinary(mockApi, label),
			manager.fetchBinary(mockApi, label),
			manager.fetchBinary(mockApi, label),
		]);

		expect(downloads).toHaveLength(3);
		for (const result of downloads) {
			expect(result).toBe(binaryPath);
		}

		// Verify binary exists and lock/progress files are cleaned up
		await expect(fs.access(binaryPath)).resolves.toBeUndefined();
		await expect(fs.access(binaryPath + ".lock")).rejects.toThrow();
		await expect(fs.access(binaryPath + ".progress.log")).rejects.toThrow();
	});

	it("redownloads when version mismatch is detected concurrently", async () => {
		const manager = setupManager(testDir);
		setupCliUtilsMocks("1.2.3");
		vi.mocked(cliUtils.version).mockImplementation(async (binPath) => {
			const fileContent = await fs.readFile(binPath, {
				encoding: "utf-8",
			});
			return fileContent.includes("1.2.3") ? "1.2.3" : "2.0.0";
		});

		// First call downloads 1.2.3, next two expect 2.0.0 (server upgraded)
		const mockApi1 = createMockApi("1.2.3", { delay: 100 });
		const mockApi2 = createMockApi("2.0.0");

		const label = "test.coder.com";
		const binaryPath = path.join(testDir, label, "bin", "coder-linux-amd64");

		// Start first call and give it time to acquire the lock
		const firstDownload = manager.fetchBinary(mockApi1, label);
		// Wait for the lock to be acquired before starting concurrent calls
		await new Promise((resolve) => setTimeout(resolve, 50));

		const downloads = await Promise.all([
			firstDownload,
			manager.fetchBinary(mockApi2, label),
			manager.fetchBinary(mockApi2, label),
		]);

		expect(downloads).toHaveLength(3);
		for (const result of downloads) {
			expect(result).toBe(binaryPath);
		}

		// Binary should be updated to 2.0.0, lock/progress files cleaned up
		await expect(fs.access(binaryPath)).resolves.toBeUndefined();
		const finalContent = await fs.readFile(binaryPath, "utf8");
		expect(finalContent).toContain("v2.0.0");
		await expect(fs.access(binaryPath + ".lock")).rejects.toThrow();
		await expect(fs.access(binaryPath + ".progress.log")).rejects.toThrow();
	});

	it.each([
		{
			name: "disk storage insufficient",
			code: "ENOSPC",
			message: "no space left on device",
		},
		{
			name: "connection timeout",
			code: "ETIMEDOUT",
			message: "connection timed out",
		},
	])("handles $name error during download", async ({ code, message }) => {
		const manager = setupManager(testDir);
		setupCliUtilsMocks("1.2.3");

		const error = new Error(`${code}: ${message}`);
		(error as NodeJS.ErrnoException).code = code;
		const mockApi = createMockApi("1.2.3", { error });

		const label = "test.coder.com";
		const binaryPath = path.join(testDir, label, "bin", "coder-linux-amd64");

		await expect(manager.fetchBinary(mockApi, label)).rejects.toThrow(
			`Unable to download binary: ${code}: ${message}`,
		);

		await expect(fs.access(binaryPath + ".lock")).rejects.toThrow();
	});
});
