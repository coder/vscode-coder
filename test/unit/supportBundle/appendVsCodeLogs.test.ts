import { strToU8, unzipSync, zipSync } from "fflate";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendVsCodeLogs } from "@/supportBundle/appendVsCodeLogs";
import { collectVsCodeDiagnostics } from "@/supportBundle/diagnostics";
import { renameWithRetry } from "@/util/fs";

import { createMockLogger } from "../../mocks/testHelpers";

const collectVsCodeDiagnosticsMock = vi.hoisted(() => vi.fn());

vi.mock("@/supportBundle/diagnostics", () => ({
	collectVsCodeDiagnostics: collectVsCodeDiagnosticsMock,
}));

// Wrap renameWithRetry so individual tests can override it via
// mockRejectedValueOnce; by default it calls through to the real impl.
vi.mock("@/util/fs", async () => {
	const actual = await vi.importActual<typeof import("@/util/fs")>("@/util/fs");
	return { ...actual, renameWithRetry: vi.fn(actual.renameWithRetry) };
});

const canTestFileMode = process.platform !== "win32";
let tmpDir: string;
const logger = createMockLogger();

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "support-bundle-"));
	vi.mocked(collectVsCodeDiagnostics).mockReset();
	vi.mocked(renameWithRetry).mockClear();
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

async function makeBundle(): Promise<string> {
	const zipPath = path.join(tmpDir, "coder-support-123.zip");
	await fs.writeFile(
		zipPath,
		zipSync({ "server/info.txt": strToU8("server data") }),
	);
	return zipPath;
}

async function readZip(zipPath: string): Promise<Record<string, string>> {
	const entries = unzipSync(await fs.readFile(zipPath));
	return Object.fromEntries(
		Object.entries(entries).map(([name, data]) => [
			name,
			Buffer.from(data).toString(),
		]),
	);
}

async function findBundleSibling(): Promise<string> {
	const sibling = (await fs.readdir(tmpDir)).find(
		(name) =>
			name.startsWith("coder-support-123-vscode-") && name.endsWith(".zip"),
	);
	if (!sibling) {
		throw new Error("support bundle sibling not found");
	}
	return path.join(tmpDir, sibling);
}

describe("appendVsCodeLogs", () => {
	it("adds collected diagnostics to the support bundle", async () => {
		const zipPath = await makeBundle();
		vi.mocked(collectVsCodeDiagnostics).mockResolvedValue(
			new Map([
				["vscode-logs/settings.json", Buffer.from("settings")],
				["vscode-logs/proxy/active.log", Buffer.from("proxy")],
			]),
		);

		await appendVsCodeLogs(zipPath, {}, logger);

		expect(await readZip(zipPath)).toEqual({
			"server/info.txt": "server data",
			"vscode-logs/proxy/active.log": "proxy",
			"vscode-logs/settings.json": "settings",
		});
	});

	it("does not rewrite the bundle when no diagnostics are found", async () => {
		const zipPath = await makeBundle();
		const beforeBytes = await fs.readFile(zipPath);
		vi.mocked(collectVsCodeDiagnostics).mockResolvedValue(new Map());

		await appendVsCodeLogs(zipPath, {}, logger);

		expect(Buffer.compare(beforeBytes, await fs.readFile(zipPath))).toBe(0);
		expect(vi.mocked(renameWithRetry)).not.toHaveBeenCalled();
	});

	it("keeps a VS Code bundle sibling when replacing the original fails", async () => {
		const zipPath = await makeBundle();
		const beforeBytes = await fs.readFile(zipPath);
		vi.mocked(collectVsCodeDiagnostics).mockResolvedValue(
			new Map([["vscode-logs/proxy/active.log", Buffer.from("proxy")]]),
		);
		vi.mocked(renameWithRetry).mockRejectedValueOnce(
			new Error("simulated rename failure"),
		);

		await appendVsCodeLogs(zipPath, {}, logger);

		expect(Buffer.compare(beforeBytes, await fs.readFile(zipPath))).toBe(0);
		expect(await readZip(await findBundleSibling())).toEqual({
			"server/info.txt": "server data",
			"vscode-logs/proxy/active.log": "proxy",
		});
	});

	it.runIf(canTestFileMode)(
		"preserves bundle permissions when replacing the original fails",
		async () => {
			const zipPath = await makeBundle();
			await fs.chmod(zipPath, 0o600);
			vi.mocked(collectVsCodeDiagnostics).mockResolvedValue(
				new Map([["vscode-logs/proxy/active.log", Buffer.from("proxy")]]),
			);
			vi.mocked(renameWithRetry).mockRejectedValueOnce(
				new Error("simulated rename failure"),
			);

			await appendVsCodeLogs(zipPath, {}, logger);

			expect((await fs.stat(await findBundleSibling())).mode & 0o777).toBe(
				0o600,
			);
		},
	);

	it("leaves the original zip and existing sibling intact when the bundle cannot be read", async () => {
		const zipPath = path.join(tmpDir, "coder-support-123.zip");
		await fs.writeFile(zipPath, "not a zip");
		const existingSiblingPath = path.join(
			tmpDir,
			"coder-support-123-vscode.zip",
		);
		await fs.writeFile(existingSiblingPath, "existing");
		const beforeBytes = await fs.readFile(zipPath);
		vi.mocked(collectVsCodeDiagnostics).mockResolvedValue(
			new Map([["vscode-logs/proxy/active.log", Buffer.from("proxy")]]),
		);

		await appendVsCodeLogs(zipPath, {}, logger);

		expect(Buffer.compare(beforeBytes, await fs.readFile(zipPath))).toBe(0);
		expect(await fs.readFile(existingSiblingPath, "utf8")).toBe("existing");
		expect(
			(await fs.readdir(tmpDir)).filter((name) =>
				name.startsWith("coder-support-123-vscode-"),
			),
		).toEqual([]);
	});

	it("leaves the bundle unchanged when diagnostics collection fails", async () => {
		const zipPath = await makeBundle();
		const beforeBytes = await fs.readFile(zipPath);
		vi.mocked(collectVsCodeDiagnostics).mockRejectedValueOnce(
			new Error("diagnostics failed"),
		);

		await appendVsCodeLogs(zipPath, {}, logger);

		expect(Buffer.compare(beforeBytes, await fs.readFile(zipPath))).toBe(0);
		expect(logger.error).toHaveBeenCalledWith(
			"Unexpected error appending VS Code logs",
			expect.any(Error),
		);
	});
});
