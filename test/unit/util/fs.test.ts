import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renameWithRetry, tempFilePath, writeAtomically } from "@/util/fs";

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

	beforeEach(() => {
		vol.reset();
		vol.mkdirSync(DIR, { recursive: true });
	});

	afterEach(() => {
		vol.reset();
	});

	it("renames the temp file onto the destination on success", async () => {
		const outputPath = `${DIR}/result.txt`;
		await writeAtomically(outputPath, (tempPath) => {
			expect(tempPath).not.toBe(outputPath);
			vol.writeFileSync(tempPath, "hello");
			return Promise.resolve();
		});

		expect(vol.readFileSync(outputPath, "utf8")).toBe("hello");
		expect(vol.readdirSync(DIR)).toEqual(["result.txt"]);
	});

	it("leaves the destination untouched and cleans up on failure", async () => {
		const outputPath = `${DIR}/result.txt`;
		vol.writeFileSync(outputPath, "previous");

		await expect(
			writeAtomically(outputPath, (tempPath) => {
				vol.writeFileSync(tempPath, "partial");
				return Promise.reject(new Error("boom"));
			}),
		).rejects.toThrow(/boom/);

		expect(vol.readFileSync(outputPath, "utf8")).toBe("previous");
		expect(vol.readdirSync(DIR)).toEqual(["result.txt"]);
	});

	it("returns the writer callback's value", async () => {
		const result = await writeAtomically(`${DIR}/x`, (tempPath) => {
			vol.writeFileSync(tempPath, "");
			return Promise.resolve(42);
		});

		expect(result).toBe(42);
	});
});
