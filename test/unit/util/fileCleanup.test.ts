import { vol } from "memfs";
import * as fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupFiles, type FileCleanupCandidate } from "@/util/fileCleanup";

import { createMockLogger } from "../../mocks/testHelpers";

import type * as fs from "node:fs";

type PickFn = (
	files: FileCleanupCandidate[],
	now: number,
) => Array<{ name: string }>;

vi.mock("node:fs/promises", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return memfs.fs.promises;
});

describe("cleanupFiles", () => {
	const logger = createMockLogger();

	beforeEach(() => {
		vi.restoreAllMocks();
		vol.reset();
	});

	afterEach(() => {
		vol.reset();
	});

	it("does not throw when directory is missing", async () => {
		await expect(
			cleanupFiles("/nope", logger, {
				fileType: "thing",
				pick: () => [],
			}),
		).resolves.toBeUndefined();
	});

	it("passes every file's name, mtime, size, and now to the pick callback", async () => {
		vol.fromJSON({ "/d/a": "hello", "/d/b": "world!" });
		vol.utimesSync("/d/a", 1_700_000_000, 1_700_000_000);
		const before = Date.now();
		const pick = vi.fn<PickFn>(() => []);

		await cleanupFiles("/d", logger, { fileType: "thing", pick });

		const [files, now] = pick.mock.calls[0];
		expect(files.toSorted((x, y) => x.name.localeCompare(y.name))).toEqual([
			{ name: "a", mtime: 1_700_000_000_000, size: 5 },
			expect.objectContaining({ name: "b", size: 6 }),
		]);
		expect(now).toBeGreaterThanOrEqual(before);
	});

	it("unlinks files chosen by pick and leaves the rest", async () => {
		vol.fromJSON({ "/d/a": "1", "/d/b": "2", "/d/c": "3" });

		await cleanupFiles("/d", logger, {
			fileType: "thing",
			pick: (files) => files.filter((f) => f.name !== "b"),
		});

		expect(vol.readdirSync("/d")).toEqual(["b"]);
	});

	it("tolerates ENOENT when a file disappears between stat and unlink", async () => {
		vol.fromJSON({ "/d/a": "" });
		const localLogger = createMockLogger();

		await cleanupFiles("/d", localLogger, {
			fileType: "thing",
			pick: (files) => {
				vol.unlinkSync("/d/a");
				return files;
			},
		});

		expect(localLogger.warn).not.toHaveBeenCalled();
		expect(localLogger.error).not.toHaveBeenCalled();
	});

	it("skips stat for files rejected by `match`", async () => {
		vol.fromJSON({
			"/d/keep.json": "{}",
			"/d/skip.txt": "no",
			"/d/keep-too.json": "{}",
		});
		const statSpy = vi.spyOn(fsPromises, "stat");

		const pick = vi.fn<PickFn>(() => []);
		await cleanupFiles("/d", logger, {
			fileType: "thing",
			match: (n) => n.endsWith(".json"),
			pick,
		});

		const stattedNames = statSpy.mock.calls
			.map((c) => String(c[0]).split("/").pop())
			.toSorted();
		expect(stattedNames).toEqual(["keep-too.json", "keep.json"]);
		expect(pick.mock.calls[0][0].map((f) => f.name).toSorted()).toEqual([
			"keep-too.json",
			"keep.json",
		]);
	});

	it("logs a debug summary listing the deleted files", async () => {
		vol.fromJSON({ "/d/a": "" });
		const localLogger = createMockLogger();

		await cleanupFiles("/d", localLogger, {
			fileType: "widget",
			pick: (files) => files,
		});

		expect(localLogger.debug).toHaveBeenCalledWith(
			expect.stringContaining("Cleaned up 1 widget(s): a"),
		);
	});
});
