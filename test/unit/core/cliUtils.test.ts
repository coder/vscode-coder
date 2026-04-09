import fs from "fs/promises";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

import * as cliUtils from "@/core/cliUtils";

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
