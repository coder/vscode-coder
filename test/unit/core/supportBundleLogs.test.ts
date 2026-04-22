import { strToU8, unzipSync, zipSync } from "fflate";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendVsCodeLogs } from "@/core/supportBundleLogs";
import { renameWithRetry } from "@/util";

import { createMockLogger } from "../../mocks/testHelpers";

// Wrap renameWithRetry so individual tests can override it via
// mockRejectedValueOnce; by default it calls through to the real impl.
vi.mock("@/util", async () => {
	const actual = await vi.importActual<typeof import("@/util")>("@/util");
	return { ...actual, renameWithRetry: vi.fn(actual.renameWithRetry) };
});

// chmod to 0o000 is a no-op as root and on Windows.
const canTestUnreadable =
	process.getuid?.() !== 0 && process.platform !== "win32";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "support-bundle-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

const logger = createMockLogger();

/** Set a file's mtime to N days in the past. */
async function setAge(filePath: string, daysAgo: number): Promise<void> {
	const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
	await fs.utimes(filePath, past, past);
}

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

function vsCodeLogKeys(entries: Record<string, string>): string[] {
	return Object.keys(entries)
		.filter((k) => k.startsWith("vscode-logs/"))
		.sort();
}

describe("appendVsCodeLogs", () => {
	it("merges logs from all three sources and skips subdirectories", async () => {
		const zipPath = await makeBundle();

		const sshLog = path.join(tmpDir, "ssh.log");
		await fs.writeFile(sshLog, "ssh");

		const proxyDir = path.join(tmpDir, "proxy");
		await fs.mkdir(proxyDir);
		await fs.writeFile(path.join(proxyDir, "coder-ssh-recent.log"), "proxy");
		await fs.mkdir(path.join(proxyDir, "subdir"));

		const extDir = path.join(tmpDir, "ext");
		await fs.mkdir(extDir);
		await fs.writeFile(path.join(extDir, "Coder.log"), "ext");

		await appendVsCodeLogs(
			zipPath,
			{
				remoteSshLogPath: sshLog,
				proxyLogDir: proxyDir,
				extensionLogDir: extDir,
			},
			logger,
		);

		const entries = await readZip(zipPath);
		expect(Object.keys(entries).sort()).toEqual([
			"server/info.txt",
			"vscode-logs/extension/Coder.log",
			"vscode-logs/proxy/coder-ssh-recent.log",
			"vscode-logs/remote-ssh/ssh.log",
		]);
		expect(entries["server/info.txt"]).toBe("server data");
		expect(entries["vscode-logs/proxy/coder-ssh-recent.log"]).toBe("proxy");
	});

	it("does not touch the zip when no logs are found", async () => {
		const zipPath = await makeBundle();
		const before = await fs.stat(zipPath);

		await appendVsCodeLogs(zipPath, {}, logger);

		expect((await fs.stat(zipPath)).mtimeMs).toBe(before.mtimeMs);
	});

	it("filters proxy logs older than 3 days by mtime", async () => {
		const zipPath = await makeBundle();

		const proxyDir = path.join(tmpDir, "proxy");
		await fs.mkdir(proxyDir);
		await fs.writeFile(path.join(proxyDir, "recent.log"), "recent");
		await fs.writeFile(path.join(proxyDir, "old.log"), "old");
		await setAge(path.join(proxyDir, "old.log"), 5);

		await appendVsCodeLogs(zipPath, { proxyLogDir: proxyDir }, logger);

		expect(vsCodeLogKeys(await readZip(zipPath))).toEqual([
			"vscode-logs/proxy/recent.log",
		]);
	});

	it("filters extension logs older than 3 days by mtime", async () => {
		const zipPath = await makeBundle();

		const extDir = path.join(tmpDir, "ext");
		await fs.mkdir(extDir);
		await fs.writeFile(path.join(extDir, "Coder-recent.log"), "recent");
		await fs.writeFile(path.join(extDir, "Coder-old.log"), "old");
		await setAge(path.join(extDir, "Coder-old.log"), 5);

		await appendVsCodeLogs(zipPath, { extensionLogDir: extDir }, logger);

		expect(vsCodeLogKeys(await readZip(zipPath))).toEqual([
			"vscode-logs/extension/Coder-recent.log",
		]);
	});

	it.runIf(canTestUnreadable)(
		"skips missing or unreadable sources and includes the rest",
		async () => {
			const zipPath = await makeBundle();

			const proxyDir = path.join(tmpDir, "proxy");
			await fs.mkdir(proxyDir);
			await fs.writeFile(path.join(proxyDir, "good.log"), "ok");
			const badLog = path.join(proxyDir, "bad.log");
			await fs.writeFile(badLog, "secret");
			await fs.chmod(badLog, 0o000);

			try {
				await appendVsCodeLogs(
					zipPath,
					{
						remoteSshLogPath: path.join(tmpDir, "nonexistent.log"),
						proxyLogDir: proxyDir,
						extensionLogDir: path.join(tmpDir, "no-such-dir"),
					},
					logger,
				);

				expect(vsCodeLogKeys(await readZip(zipPath))).toEqual([
					"vscode-logs/proxy/good.log",
				]);
			} finally {
				await fs.chmod(badLog, 0o644);
			}
		},
	);

	it("keeps the -vscode.zip sibling when rename fails", async () => {
		const zipPath = await makeBundle();
		const before = await fs.stat(zipPath);

		const sshLog = path.join(tmpDir, "ssh.log");
		await fs.writeFile(sshLog, "ssh content");

		vi.mocked(renameWithRetry).mockRejectedValueOnce(
			new Error("simulated rename failure"),
		);

		await appendVsCodeLogs(zipPath, { remoteSshLogPath: sshLog }, logger);

		expect((await fs.stat(zipPath)).mtimeMs).toBe(before.mtimeMs);

		const siblingPath = path.join(tmpDir, "coder-support-123-vscode.zip");
		const entries = await readZip(siblingPath);
		expect(Object.keys(entries).sort()).toEqual([
			"server/info.txt",
			"vscode-logs/remote-ssh/ssh.log",
		]);
		expect(entries["vscode-logs/remote-ssh/ssh.log"]).toBe("ssh content");
	});

	it("leaves the original zip intact and cleans up the partial sibling when corrupted", async () => {
		const zipPath = path.join(tmpDir, "coder-support-123.zip");
		await fs.writeFile(zipPath, "not a zip");
		const before = await fs.stat(zipPath);

		const logPath = path.join(tmpDir, "ssh.log");
		await fs.writeFile(logPath, "content");

		await appendVsCodeLogs(zipPath, { remoteSshLogPath: logPath }, logger);

		expect((await fs.stat(zipPath)).mtimeMs).toBe(before.mtimeMs);
		expect(await fs.readdir(tmpDir)).not.toContain(
			"coder-support-123-vscode.zip",
		);
	});
});
