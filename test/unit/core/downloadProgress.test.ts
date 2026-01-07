import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as downloadProgress from "@/core/downloadProgress";

describe("downloadProgress", () => {
	let testDir: string;
	let testLogPath: string;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "download-progress-test-"),
		);
		testLogPath = path.join(testDir, "test.progress.log");
	});

	afterEach(async () => {
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch {
			// Ignore
		}
	});

	describe("writeProgress", () => {
		it("should write and overwrite progress", async () => {
			await downloadProgress.writeProgress(testLogPath, {
				bytesDownloaded: 1000,
				totalBytes: 10000,
				status: "downloading",
			});
			const first = JSON.parse(
				(await fs.readFile(testLogPath, "utf-8")).trim(),
			) as downloadProgress.DownloadProgress;
			expect(first.bytesDownloaded).toBe(1000);

			await downloadProgress.writeProgress(testLogPath, {
				bytesDownloaded: 2000,
				totalBytes: null,
				status: "verifying",
			});
			const second = JSON.parse(
				(await fs.readFile(testLogPath, "utf-8")).trim(),
			) as downloadProgress.DownloadProgress;
			expect(second.bytesDownloaded).toBe(2000);
			expect(second.totalBytes).toBeNull();
		});

		it("should create nested directories", async () => {
			const nestedPath = path.join(testDir, "nested", "dir", "progress.log");
			await downloadProgress.writeProgress(nestedPath, {
				bytesDownloaded: 500,
				totalBytes: 5000,
				status: "downloading",
			});
			expect(await fs.readFile(nestedPath, "utf-8")).toBeTruthy();
		});
	});

	describe("readProgress", () => {
		it("should read progress from log file", async () => {
			const expectedProgress = {
				bytesDownloaded: 1500,
				totalBytes: 10000,
				status: "downloading",
			};

			await fs.writeFile(testLogPath, JSON.stringify(expectedProgress) + "\n");
			const progress = await downloadProgress.readProgress(testLogPath);
			expect(progress).toEqual(expectedProgress);
		});

		it("should return null for missing, empty, or invalid files", async () => {
			expect(
				await downloadProgress.readProgress(path.join(testDir, "nonexistent")),
			).toBeNull();

			await fs.writeFile(testLogPath, "");
			expect(await downloadProgress.readProgress(testLogPath)).toBeNull();

			await fs.writeFile(testLogPath, "invalid json");
			expect(await downloadProgress.readProgress(testLogPath)).toBeNull();

			await fs.writeFile(testLogPath, JSON.stringify({ incomplete: true }));
			expect(await downloadProgress.readProgress(testLogPath)).toBeNull();
		});
	});

	describe("clearProgress", () => {
		it("should remove existing file or ignore missing file", async () => {
			await fs.writeFile(testLogPath, "test");
			await downloadProgress.clearProgress(testLogPath);
			await expect(fs.readFile(testLogPath)).rejects.toThrow();

			await expect(
				downloadProgress.clearProgress(path.join(testDir, "nonexistent")),
			).resolves.toBeUndefined();
		});
	});
});
