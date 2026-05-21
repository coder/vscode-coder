import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	addFiles,
	collectDirFiles,
	collectMatchingFiles,
	isLogFile,
	normalizeZipPath,
	prefixFiles,
} from "@/supportBundle/files";

import { createMockLogger } from "../../mocks/testHelpers";

let tmpDir: string;
const logger = createMockLogger();

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "support-bundle-files-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

async function setAge(filePath: string, daysAgo: number): Promise<void> {
	const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
	await fs.utimes(filePath, past, past);
}

describe("support bundle file helpers", () => {
	it("normalizes zip paths and identifies log files", () => {
		expect(normalizeZipPath("a/b/c.log")).toBe("a/b/c.log");
		expect(isLogFile("Coder.log")).toBe(true);
		expect(isLogFile("settings.json")).toBe(false);
	});

	it("prefixes and merges file maps", () => {
		const target = new Map([["existing", Buffer.from("old")]]);
		addFiles(
			target,
			prefixFiles("vscode-logs/proxy", new Map([["a.log", Buffer.from("a")]])),
		);

		expect([...target.keys()].sort()).toEqual([
			"existing",
			"vscode-logs/proxy/a.log",
		]);
	});

	it("collects recent matching files and skips old files and subdirectories", async () => {
		await fs.writeFile(path.join(tmpDir, "recent.log"), "recent");
		await fs.writeFile(path.join(tmpDir, "old.log"), "old");
		await fs.writeFile(path.join(tmpDir, "notes.txt"), "notes");
		await fs.mkdir(path.join(tmpDir, "subdir"));
		await setAge(path.join(tmpDir, "old.log"), 5);

		const files = await collectDirFiles(tmpDir, logger, isLogFile);

		expect(files).toEqual(new Map([["recent.log", Buffer.from("recent")]]));
	});

	it("walks matching recent files recursively", async () => {
		const nested = path.join(tmpDir, "window1", "output_logging_1");
		await fs.mkdir(nested, { recursive: true });
		await fs.writeFile(path.join(nested, "1-Remote - SSH.log"), "ssh");

		const files = await collectMatchingFiles(
			tmpDir,
			logger,
			(_relativePath, fileName) => fileName.includes("Remote - SSH"),
		);

		expect(files).toMatchObject([
			{
				data: Buffer.from("ssh"),
				relativePath: path.join(
					"window1",
					"output_logging_1",
					"1-Remote - SSH.log",
				),
			},
		]);
	});
});
