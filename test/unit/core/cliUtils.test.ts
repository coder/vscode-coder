import fs from "fs/promises";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

import * as cliUtils from "@/core/cliUtils";

import { getFixturePath } from "../../utils/fixtures";
import { isWindows } from "../../utils/platform";

describe("CliUtils", () => {
	const tmp = path.join(os.tmpdir(), "vscode-coder-tests");

	beforeAll(async () => {
		// Clean up from previous tests, if any.
		await fs.rm(tmp, { recursive: true, force: true });
		await fs.mkdir(tmp, { recursive: true });
	});

	it("name", () => {
		expect(cliUtils.name().startsWith("coder-")).toBeTruthy();
	});

	it("stat", async () => {
		const binPath = path.join(tmp, "stat");
		expect(await cliUtils.stat(binPath)).toBeUndefined();

		await fs.writeFile(binPath, "test");
		expect((await cliUtils.stat(binPath))?.size).toBe(4);
	});

	it.skipIf(isWindows())("version", async () => {
		const binPath = path.join(tmp, "version");
		await expect(cliUtils.version(binPath)).rejects.toThrow("ENOENT");

		const binTmpl = await fs.readFile(
			getFixturePath("scripts", "bin.bash"),
			"utf8",
		);
		await fs.writeFile(binPath, binTmpl.replace("$ECHO", "hello"));
		await expect(cliUtils.version(binPath)).rejects.toThrow("EACCES");

		await fs.chmod(binPath, "755");
		await expect(cliUtils.version(binPath)).rejects.toThrow("Unexpected token");

		await fs.writeFile(binPath, binTmpl.replace("$ECHO", "{}"));
		await expect(cliUtils.version(binPath)).rejects.toThrow(
			"No version found in output",
		);

		await fs.writeFile(
			binPath,
			binTmpl.replace(
				"$ECHO",
				JSON.stringify({
					version: "v0.0.0",
				}),
			),
		);
		expect(await cliUtils.version(binPath)).toBe("v0.0.0");

		const oldTmpl = await fs.readFile(
			getFixturePath("scripts", "bin.old.bash"),
			"utf8",
		);
		const old = (stderr: string, stdout: string): string => {
			return oldTmpl.replace("$STDERR", stderr).replace("$STDOUT", stdout);
		};

		// Should fall back only if it says "unknown flag".
		await fs.writeFile(binPath, old("foobar", "Coder v1.1.1"));
		await expect(cliUtils.version(binPath)).rejects.toThrow("foobar");

		await fs.writeFile(binPath, old("unknown flag: --output", "Coder v1.1.1"));
		expect(await cliUtils.version(binPath)).toBe("v1.1.1");

		// Should trim off the newline if necessary.
		await fs.writeFile(
			binPath,
			old("unknown flag: --output\n", "Coder v1.1.1\n"),
		);
		expect(await cliUtils.version(binPath)).toBe("v1.1.1");

		// Error with original error if it does not begin with "Coder".
		await fs.writeFile(binPath, old("unknown flag: --output", "Unrelated"));
		await expect(cliUtils.version(binPath)).rejects.toThrow("unknown flag");

		// Error if no version.
		await fs.writeFile(binPath, old("unknown flag: --output", "Coder"));
		await expect(cliUtils.version(binPath)).rejects.toThrow("No version found");
	});

	it("rmOld", async () => {
		const binDir = path.join(tmp, "bins");
		expect(await cliUtils.rmOld(path.join(binDir, "bin1"))).toStrictEqual([]);

		await fs.mkdir(binDir, { recursive: true });
		await fs.writeFile(path.join(binDir, "bin.old-1"), "echo hello");
		await fs.writeFile(path.join(binDir, "bin.old-2"), "echo hello");
		await fs.writeFile(path.join(binDir, "bin.temp-1"), "echo hello");
		await fs.writeFile(path.join(binDir, "bin.temp-2"), "echo hello");
		await fs.writeFile(path.join(binDir, "bin1"), "echo hello");
		await fs.writeFile(path.join(binDir, "bin2"), "echo hello");
		await fs.writeFile(path.join(binDir, "bin.asc"), "echo hello");
		await fs.writeFile(path.join(binDir, "bin.old-1.asc"), "echo hello");
		await fs.writeFile(path.join(binDir, "bin.temp-2.asc"), "echo hello");

		expect(await cliUtils.rmOld(path.join(binDir, "bin1"))).toStrictEqual([
			{
				fileName: "bin.asc",
				error: undefined,
			},
			{
				fileName: "bin.old-1",
				error: undefined,
			},
			{
				fileName: "bin.old-1.asc",
				error: undefined,
			},
			{
				fileName: "bin.old-2",
				error: undefined,
			},
			{
				fileName: "bin.temp-1",
				error: undefined,
			},
			{
				fileName: "bin.temp-2",
				error: undefined,
			},
			{
				fileName: "bin.temp-2.asc",
				error: undefined,
			},
		]);

		expect(await fs.readdir(path.join(tmp, "bins"))).toStrictEqual([
			"bin1",
			"bin2",
		]);
	});

	it("ETag", async () => {
		const binPath = path.join(tmp, "hash");

		await fs.writeFile(binPath, "foobar");
		expect(await cliUtils.eTag(binPath)).toBe(
			"8843d7f92416211de9ebb963ff4ce28125932878",
		);

		await fs.writeFile(binPath, "test");
		expect(await cliUtils.eTag(binPath)).toBe(
			"a94a8fe5ccb19ba61c4c0873d391e987982fbbd3",
		);
	});
});
