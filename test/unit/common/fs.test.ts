import { vol } from "memfs";
import * as fsPromises from "node:fs/promises";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	cleanupFiles,
	expandPath,
	renameWithRetry,
	tempFilePath,
	writeAtomically,
} from "@/common/fs";

import { createMockLogger } from "../../mocks/testHelpers";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

describe("tempFilePath", () => {
	it("prepends basePath and suffix before the random part", () => {
		const result = tempFilePath("/a/b/file", "temp");
		const prefix = "/a/b/file.temp-";
		expect(result.startsWith(prefix)).toBe(true);
		// prefix + uuid(8)
		expect(result).toHaveLength(prefix.length + 8);
	});

	it("generates different paths on each call", () => {
		const a = tempFilePath("/x", "tmp");
		const b = tempFilePath("/x", "tmp");
		expect(a).not.toBe(b);
	});

	it("uses the provided suffix", () => {
		const result = tempFilePath("/base", "old");
		expect(result.startsWith("/base.old-")).toBe(true);
	});
});

describe("renameWithRetry", () => {
	const realPlatform = process.platform;

	function makeErrno(code: string): NodeJS.ErrnoException {
		const err = new Error(code);
		(err as NodeJS.ErrnoException).code = code;
		return err;
	}

	function setPlatform(value: string) {
		Object.defineProperty(process, "platform", { value });
	}

	afterEach(() => {
		setPlatform(realPlatform);
		vi.useRealTimers();
	});

	it("succeeds on first attempt", async () => {
		const renameFn = vi.fn<(s: string, d: string) => Promise<void>>();
		renameFn.mockResolvedValueOnce(undefined);
		await renameWithRetry(renameFn, "/a", "/b");
		expect(renameFn).toHaveBeenCalledTimes(1);
		expect(renameFn).toHaveBeenCalledWith("/a", "/b");
	});

	it("skips retry logic on non-Windows platforms", async () => {
		setPlatform("linux");
		const renameFn = vi.fn<(s: string, d: string) => Promise<void>>();
		renameFn.mockRejectedValueOnce(makeErrno("EPERM"));

		await expect(renameWithRetry(renameFn, "/a", "/b")).rejects.toThrow(
			"EPERM",
		);
		expect(renameFn).toHaveBeenCalledTimes(1);
	});

	describe("on Windows", () => {
		beforeEach(() => setPlatform("win32"));

		it.each(["EPERM", "EACCES", "EBUSY"])(
			"retries on transient %s and succeeds",
			async (code) => {
				const renameFn = vi.fn<(s: string, d: string) => Promise<void>>();
				renameFn
					.mockRejectedValueOnce(makeErrno(code))
					.mockResolvedValueOnce(undefined);

				await renameWithRetry(renameFn, "/a", "/b", 60_000, 10);
				expect(renameFn).toHaveBeenCalledTimes(2);
			},
		);

		it("throws after timeout is exceeded", async () => {
			vi.useFakeTimers();
			const renameFn = vi.fn<(s: string, d: string) => Promise<void>>();
			const epermError = makeErrno("EPERM");
			renameFn.mockImplementation(() => Promise.reject(epermError));

			const promise = renameWithRetry(renameFn, "/a", "/b", 5);
			const assertion = expect(promise).rejects.toThrow(epermError);
			await vi.advanceTimersByTimeAsync(100);
			await assertion;
		});

		it.each(["EXDEV", "ENOENT", "EISDIR"])(
			"does not retry non-transient %s",
			async (code) => {
				const renameFn = vi.fn<(s: string, d: string) => Promise<void>>();
				renameFn.mockRejectedValueOnce(makeErrno(code));

				await expect(renameWithRetry(renameFn, "/a", "/b")).rejects.toThrow(
					code,
				);
				expect(renameFn).toHaveBeenCalledTimes(1);
			},
		);
	});
});

describe("writeAtomically", () => {
	const DIR = "/atomic";
	const noopCleanup = () => {};

	beforeEach(() => {
		vol.reset();
		vol.mkdirSync(DIR, { recursive: true });
	});

	afterEach(() => {
		vol.reset();
	});

	it("renames the temp file onto the destination on success", async () => {
		const outputPath = `${DIR}/result.txt`;
		await writeAtomically(
			outputPath,
			(tempPath) => {
				expect(tempPath).not.toBe(outputPath);
				vol.writeFileSync(tempPath, "hello");
				return Promise.resolve();
			},
			noopCleanup,
		);

		expect(vol.readFileSync(outputPath, "utf8")).toBe("hello");
		expect(vol.readdirSync(DIR)).toEqual(["result.txt"]);
	});

	it("leaves the destination untouched and cleans up on failure", async () => {
		const outputPath = `${DIR}/result.txt`;
		vol.writeFileSync(outputPath, "previous");

		await expect(
			writeAtomically(
				outputPath,
				(tempPath) => {
					vol.writeFileSync(tempPath, "partial");
					return Promise.reject(new Error("boom"));
				},
				noopCleanup,
			),
		).rejects.toThrow(/boom/);

		expect(vol.readFileSync(outputPath, "utf8")).toBe("previous");
		expect(vol.readdirSync(DIR)).toEqual(["result.txt"]);
	});

	it("returns the writer callback's value", async () => {
		const result = await writeAtomically(
			`${DIR}/x`,
			(tempPath) => {
				vol.writeFileSync(tempPath, "");
				return Promise.resolve(42);
			},
			noopCleanup,
		);

		expect(result).toBe(42);
	});

	it("invokes onCleanupError when temp removal fails", async () => {
		vi.spyOn(fsPromises, "rm").mockRejectedValueOnce(new Error("rm boom"));
		const onCleanupError = vi.fn();

		await expect(
			writeAtomically(
				`${DIR}/x.txt`,
				() => Promise.reject(new Error("write boom")),
				onCleanupError,
			),
		).rejects.toThrow(/write boom/);

		expect(onCleanupError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "rm boom" }),
			expect.stringMatching(/^\/atomic\/x\.txt\.temp-/),
		);
	});

	it("rethrows the writer error when onCleanupError itself throws", async () => {
		vi.spyOn(fsPromises, "rm").mockRejectedValueOnce(new Error("rm boom"));
		const throwingCleanup = () => {
			throw new Error("callback boom");
		};

		await expect(
			writeAtomically(
				`${DIR}/x.txt`,
				() => Promise.reject(new Error("write boom")),
				throwingCleanup,
			),
		).rejects.toThrow(/write boom/);
	});
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
			cleanupFiles("/nope", logger, { label: "thing", select: () => [] }),
		).resolves.toBeUndefined();
	});

	it("unlinks the files chosen by select and leaves the rest", async () => {
		const { logger } = setup({ "/d/a": "1", "/d/b": "2", "/d/c": "3" });

		await cleanupFiles("/d", logger, {
			label: "thing",
			select: (files) => files.filter((f) => f.name !== "b"),
		});

		expect(vol.readdirSync("/d")).toEqual(["b"]);
	});

	it("exposes mtime, size, and the current time so select can filter on them", async () => {
		const { logger } = setup({
			"/d/old-big": "x".repeat(100),
			"/d/new-small": "x",
		});
		// 1970-01-01: definitely older than `now`.
		vol.utimesSync("/d/old-big", 1, 1);

		await cleanupFiles("/d", logger, {
			label: "thing",
			select: (files, now) =>
				files.filter((f) => now - f.mtime > 1000 && f.size > 50),
		});

		expect(vol.readdirSync("/d")).toEqual(["new-small"]);
	});

	it("only feeds select the files matched by `filter`", async () => {
		const { logger } = setup({
			"/d/keep.json": "{}",
			"/d/skip.txt": "no",
			"/d/keep-too.json": "{}",
		});

		await cleanupFiles("/d", logger, {
			label: "thing",
			filter: (n) => n.endsWith(".json"),
			select: (files) => files,
		});

		expect(vol.readdirSync("/d")).toEqual(["skip.txt"]);
	});

	it("keeps going when a file disappears between stat and unlink", async () => {
		const { logger } = setup({ "/d/a": "1", "/d/b": "2" });

		await cleanupFiles("/d", logger, {
			label: "thing",
			select: (files) => {
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

		const select = vi.fn(() => []);
		await expect(
			cleanupFiles("/d", logger, { label: "thing", select }),
		).resolves.toBeUndefined();
		expect(select).not.toHaveBeenCalled();
	});

	it("clamps select names to their basename so unlinks cannot escape the directory", async () => {
		const { logger } = setup({
			"/d/inside.txt": "x",
			"/outside.txt": "y",
		});

		await cleanupFiles("/d", logger, {
			label: "thing",
			select: () => [{ name: "../outside.txt" }],
		});

		expect(vol.existsSync("/outside.txt")).toBe(true);
	});
});

describe("expandPath", () => {
	const home = os.homedir();

	it("expands tilde at start of path", () => {
		expect(expandPath("~/foo/bar")).toBe(`${home}/foo/bar`);
	});

	it("expands standalone tilde", () => {
		expect(expandPath("~")).toBe(home);
	});

	it("does not expand tilde in middle of path", () => {
		expect(expandPath("/foo/~/bar")).toBe("/foo/~/bar");
	});

	it("expands ${userHome} variable", () => {
		expect(expandPath("${userHome}/foo")).toBe(`${home}/foo`);
	});

	it("expands multiple ${userHome} variables", () => {
		expect(expandPath("${userHome}/foo/${userHome}/bar")).toBe(
			`${home}/foo/${home}/bar`,
		);
	});

	it("leaves paths without tilde or variable unchanged", () => {
		expect(expandPath("/absolute/path")).toBe("/absolute/path");
		expect(expandPath("relative/path")).toBe("relative/path");
	});

	it("expands both tilde and ${userHome}", () => {
		expect(expandPath("~/${userHome}/foo")).toBe(`${home}/${home}/foo`);
	});

	describe("${env:VAR}", () => {
		const envKey = "CODER_EXPAND_PATH_TEST";
		const ref = "${env:" + envKey + "}";

		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it("substitutes a present env var", () => {
			vi.stubEnv(envKey, "/data");
			expect(expandPath(`${ref}/foo`)).toBe("/data/foo");
		});

		it("replaces a missing env var with an empty string", () => {
			vi.stubEnv(envKey, undefined);
			expect(expandPath(`prefix-${ref}-suffix`)).toBe("prefix--suffix");
		});

		it("substitutes multiple occurrences in one string", () => {
			vi.stubEnv(envKey, "data");
			expect(expandPath(`${ref}/${ref}`)).toBe("data/data");
		});

		it("expands tilde or ${userHome} that appears inside the env value", () => {
			vi.stubEnv(envKey, "~/projects");
			expect(expandPath(`${ref}/x`)).toBe(`${home}/projects/x`);
		});

		it("ignores ${env:...} with invalid names", () => {
			expect(expandPath("${env:1BAD}/x")).toBe("${env:1BAD}/x");
		});
	});
});
