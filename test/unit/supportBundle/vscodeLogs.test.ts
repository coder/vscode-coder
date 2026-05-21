import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	collectWindowLogDirs,
	resolveLogContext,
} from "@/supportBundle/vscodeLogs";

import { createMockLogger } from "../../mocks/testHelpers";

let tmpDir: string;
const logger = createMockLogger();

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "support-bundle-vscode-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveLogContext", () => {
	it("resolves VS Code session log layout", () => {
		const extensionLogDir = path.join(
			tmpDir,
			"20240101T000000",
			"window1",
			"exthost",
			"coder.coder-remote",
		);

		expect(resolveLogContext(extensionLogDir)).toEqual({
			currentWindowPath: path.join(tmpDir, "20240101T000000", "window1"),
			logsRoot: tmpDir,
		});
	});

	it("resolves flat window log layout", () => {
		const extensionLogDir = path.join(
			tmpDir,
			"window1",
			"exthost",
			"coder.coder-remote",
		);

		expect(resolveLogContext(extensionLogDir)).toEqual({
			currentWindowPath: path.join(tmpDir, "window1"),
			logsRoot: tmpDir,
		});
	});

	it("ignores paths outside the Coder extension log layout", () => {
		expect(
			resolveLogContext(path.join(tmpDir, "window1", "other")),
		).toBeUndefined();
	});
});

describe("collectWindowLogDirs", () => {
	it("finds and sorts session and flat window directories", async () => {
		await fs.mkdir(path.join(tmpDir, "20240102T000000", "window2"), {
			recursive: true,
		});
		await fs.mkdir(path.join(tmpDir, "20240101T000000", "window1"), {
			recursive: true,
		});
		await fs.mkdir(path.join(tmpDir, "window3"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, "not-a-window.log"), "ignore");

		await expect(collectWindowLogDirs(tmpDir, logger)).resolves.toEqual([
			{
				relativePath: "20240101T000000/window1",
				windowPath: path.join(tmpDir, "20240101T000000", "window1"),
			},
			{
				relativePath: "20240102T000000/window2",
				windowPath: path.join(tmpDir, "20240102T000000", "window2"),
			},
			{
				relativePath: "window3",
				windowPath: path.join(tmpDir, "window3"),
			},
		]);
	});
});
