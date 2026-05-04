import { vol } from "memfs";
import * as fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupFiles } from "@/util/fileCleanup";

import { createMockLogger } from "../../mocks/testHelpers";

import type * as fs from "node:fs";

vi.mock("node:fs/promises", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return memfs.fs.promises;
});

describe("cleanupFiles", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vol.reset();
	});

	afterEach(() => {
		vol.reset();
	});

	function setup(files: Record<string, string> = {}) {
		vol.fromJSON(files);
		return { logger: createMockLogger() };
	}

	it("does not throw when the directory is missing", async () => {
		const { logger } = setup();
		await expect(
			cleanupFiles("/nope", logger, { fileType: "thing", pick: () => [] }),
		).resolves.toBeUndefined();
	});

	it("unlinks the files chosen by pick and leaves the rest", async () => {
		const { logger } = setup({ "/d/a": "1", "/d/b": "2", "/d/c": "3" });

		await cleanupFiles("/d", logger, {
			fileType: "thing",
			pick: (files) => files.filter((f) => f.name !== "b"),
		});

		expect(vol.readdirSync("/d")).toEqual(["b"]);
	});

	it("exposes mtime, size, and the current time so pick can filter on them", async () => {
		const { logger } = setup({
			"/d/old-big": "x".repeat(100),
			"/d/new-small": "x",
		});
		// 1970-01-01: definitely older than `now`.
		vol.utimesSync("/d/old-big", 1, 1);

		await cleanupFiles("/d", logger, {
			fileType: "thing",
			pick: (files, now) =>
				files.filter((f) => now - f.mtime > 1000 && f.size > 50),
		});

		expect(vol.readdirSync("/d")).toEqual(["new-small"]);
	});

	it("only feeds pick the files matched by `match`", async () => {
		const { logger } = setup({
			"/d/keep.json": "{}",
			"/d/skip.txt": "no",
			"/d/keep-too.json": "{}",
		});

		await cleanupFiles("/d", logger, {
			fileType: "thing",
			match: (n) => n.endsWith(".json"),
			pick: (files) => files,
		});

		expect(vol.readdirSync("/d")).toEqual(["skip.txt"]);
	});

	it("keeps going when a file disappears between stat and unlink", async () => {
		const { logger } = setup({ "/d/a": "1", "/d/b": "2" });

		await cleanupFiles("/d", logger, {
			fileType: "thing",
			pick: (files) => {
				vol.unlinkSync("/d/a");
				return files;
			},
		});

		expect(vol.readdirSync("/d")).toEqual([]);
	});

	it("does not throw when readdir fails for reasons other than ENOENT", async () => {
		const { logger } = setup();
		const err = Object.assign(new Error("denied"), { code: "EACCES" });
		vi.spyOn(fsPromises, "readdir").mockRejectedValueOnce(err);

		const pick = vi.fn(() => []);
		await expect(
			cleanupFiles("/d", logger, { fileType: "thing", pick }),
		).resolves.toBeUndefined();
		expect(pick).not.toHaveBeenCalled();
	});

	it("clamps pick names to their basename so unlinks cannot escape the directory", async () => {
		const { logger } = setup({
			"/d/inside.txt": "x",
			"/outside.txt": "y",
		});

		await cleanupFiles("/d", logger, {
			fileType: "thing",
			pick: () => [{ name: "../outside.txt" }],
		});

		expect(vol.existsSync("/outside.txt")).toBe(true);
	});
});
