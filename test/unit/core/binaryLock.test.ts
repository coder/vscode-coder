import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { BinaryLock } from "@/core/binaryLock";
import * as downloadProgress from "@/core/downloadProgress";

import {
	createMockLogger,
	MockProgressReporter,
} from "../../mocks/testHelpers";

vi.mock("vscode");

vi.mock("@/vscodeProposed", () => ({
	vscodeProposed: vscode,
}));

// Mock proper-lockfile
vi.mock("proper-lockfile", () => ({
	lock: vi.fn(),
}));

// Mock downloadProgress module
vi.mock("@/core/downloadProgress", () => ({
	STALE_TIMEOUT_MS: 15000,
	readProgress: vi.fn(),
	writeProgress: vi.fn(),
	clearProgress: vi.fn(),
}));

describe("BinaryLock", () => {
	let binaryLock: BinaryLock;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockProgress: MockProgressReporter;
	let mockRelease: () => Promise<void>;

	const createLockError = () => {
		const error = new Error("Lock is busy") as NodeJS.ErrnoException;
		error.code = "ELOCKED";
		return error;
	};

	beforeEach(() => {
		mockLogger = createMockLogger();
		mockProgress = new MockProgressReporter();
		mockRelease = vi.fn().mockResolvedValue(undefined);

		binaryLock = new BinaryLock(mockLogger);
	});

	describe("acquireLockOrWait", () => {
		it("should acquire lock immediately when available", async () => {
			const { lock } = await import("proper-lockfile");
			vi.mocked(lock).mockResolvedValue(mockRelease);

			const result = await binaryLock.acquireLockOrWait(
				"/path/to/binary",
				"/path/to/progress.log",
			);

			expect(result.release).toBe(mockRelease);
			expect(result.waited).toBe(false);
			expect(lock).toHaveBeenCalledWith("/path/to/binary", {
				stale: 15000,
				retries: 0,
				realpath: false,
			});
		});

		it("should wait and monitor progress when lock is held", async () => {
			const { lock } = await import("proper-lockfile");

			vi.mocked(lock)
				.mockRejectedValueOnce(createLockError())
				.mockResolvedValueOnce(mockRelease);

			vi.mocked(downloadProgress.readProgress).mockResolvedValue({
				bytesDownloaded: 1024,
				totalBytes: 2048,
				status: "downloading",
			});

			const result = await binaryLock.acquireLockOrWait(
				"/path/to/binary",
				"/path/to/progress.log",
			);

			expect(result.release).toBe(mockRelease);
			expect(result.waited).toBe(true);

			const reports = mockProgress.getProgressReports();
			expect(reports.length).toBeGreaterThan(0);
			expect(reports[0].message).toBe("1.02 kB / 2.05 kB");
		});

		it.each([
			{
				name: "downloading with known size",
				progress: {
					bytesDownloaded: 5000000,
					totalBytes: 10000000,
					status: "downloading" as const,
				},
				expectedMessage: "5 MB / 10 MB",
			},
			{
				name: "downloading with unknown size",
				progress: {
					bytesDownloaded: 1024,
					totalBytes: null,
					status: "downloading" as const,
				},
				expectedMessage: "1.02 kB / unknown",
			},
			{
				name: "verifying signature",
				progress: {
					bytesDownloaded: 0,
					totalBytes: null,
					status: "verifying" as const,
				},
				expectedMessage: "Verifying signature...",
			},
		])(
			"should report progress while waiting: $name",
			async ({ progress, expectedMessage }) => {
				const { lock } = await import("proper-lockfile");

				let callCount = 0;
				vi.mocked(lock).mockImplementation(() => {
					callCount++;
					if (callCount === 1) {
						return Promise.reject(createLockError());
					}
					return Promise.resolve(mockRelease);
				});

				vi.mocked(downloadProgress.readProgress).mockResolvedValue(progress);

				await binaryLock.acquireLockOrWait(
					"/path/to/binary",
					"/path/to/progress.log",
				);

				const reports = mockProgress.getProgressReports();
				expect(reports.length).toBeGreaterThan(0);
				expect(reports[0].message).toContain(expectedMessage);
			},
		);

		it("should re-throw non-ELOCKED errors", async () => {
			const { lock } = await import("proper-lockfile");
			const testError = new Error("Filesystem error");
			vi.mocked(lock).mockRejectedValue(testError);

			await expect(
				binaryLock.acquireLockOrWait(
					"/path/to/binary",
					"/path/to/progress.log",
				),
			).rejects.toThrow("Filesystem error");
		});
	});
});
