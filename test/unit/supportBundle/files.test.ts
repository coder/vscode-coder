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
	readLogFile,
} from "@/supportBundle/files";

import { createMockLogger, setAge } from "../../mocks/testHelpers";

let tmpDir: string;
const logger = createMockLogger();

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "support-bundle-files-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("support bundle file helpers", () => {
	it("normalizes zip paths and identifies log files", () => {
		expect(normalizeZipPath("a/b/c.log")).toBe("a/b/c.log");
		expect(isLogFile("Coder.log")).toBe(true);
		expect(isLogFile("Coder.log.1")).toBe(true);
		expect(isLogFile("Coder.log.12")).toBe(true);
		expect(isLogFile("settings.json")).toBe(false);
		expect(isLogFile("Coder.log.gz")).toBe(false);
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

	it("truncates oversized log files to the tail", async () => {
		const filePath = path.join(tmpDir, "huge.log");
		const head = Buffer.alloc(60 * 1024 * 1024, "H");
		const tail = Buffer.from("TAIL_MARKER\n");
		await fs.writeFile(filePath, Buffer.concat([head, tail]));

		const result = await readLogFile(filePath, logger);

		expect(result?.data.byteLength).toBe(50 * 1024 * 1024);
		expect(
			Buffer.from(result?.data ?? new Uint8Array())
				.subarray(-tail.byteLength)
				.toString(),
		).toBe("TAIL_MARKER\n");
	});

	it.runIf(process.platform !== "win32")(
		"does not follow symlinks when reading files",
		async () => {
			const outsideTarget = path.join(tmpDir, "outside.secret");
			await fs.writeFile(outsideTarget, "should-not-be-read");
			const logsDir = path.join(tmpDir, "logs");
			await fs.mkdir(logsDir);
			await fs.symlink(outsideTarget, path.join(logsDir, "evil.log"));
			await fs.writeFile(path.join(logsDir, "good.log"), "good");

			const files = await collectDirFiles(logsDir, logger, isLogFile);

			expect(files).toEqual(new Map([["good.log", Buffer.from("good")]]));
		},
	);
});
