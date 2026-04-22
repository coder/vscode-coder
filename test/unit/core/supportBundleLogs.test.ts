import { strToU8, unzipSync, zipSync } from "fflate";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendVsCodeLogs, collectLogFiles } from "@/core/supportBundleLogs";

import { createMockLogger } from "../../mocks/testHelpers";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "support-bundle-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

const logger = createMockLogger();

function proxyLogName(daysAgo: number): string {
	const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
	return `coder-ssh-${ts}-abc123.log`;
}

describe("collectLogFiles", () => {
	it("collects from all three sources and skips subdirectories", async () => {
		const sshLog = path.join(tmpDir, "ssh.log");
		await fs.writeFile(sshLog, "ssh");

		const recentLog = proxyLogName(1);
		const proxyDir = path.join(tmpDir, "proxy");
		await fs.mkdir(proxyDir);
		await fs.writeFile(path.join(proxyDir, recentLog), "proxy");
		await fs.mkdir(path.join(proxyDir, "subdir"));

		const extDir = path.join(tmpDir, "ext");
		await fs.mkdir(extDir);
		await fs.writeFile(path.join(extDir, "Coder.log"), "ext");

		const files = await collectLogFiles(
			{
				remoteSshLogPath: sshLog,
				proxyLogDir: proxyDir,
				extensionLogDir: extDir,
			},
			logger,
		);

		expect(Object.keys(files).sort()).toEqual([
			"vscode-logs/extension/Coder.log",
			`vscode-logs/proxy/${recentLog}`,
			"vscode-logs/remote-ssh/ssh.log",
		]);
		expect(
			Buffer.from(files[`vscode-logs/proxy/${recentLog}`]).toString(),
		).toBe("proxy");
	});

	it("returns empty when no sources are provided", async () => {
		const files = await collectLogFiles({}, logger);
		expect(Object.keys(files)).toHaveLength(0);
	});

	it("filters proxy logs older than 3 days by filename timestamp", async () => {
		const proxyDir = path.join(tmpDir, "proxy");
		await fs.mkdir(proxyDir);

		const recentLog = proxyLogName(1);
		const oldLog = proxyLogName(5);
		await fs.writeFile(path.join(proxyDir, recentLog), "recent");
		await fs.writeFile(path.join(proxyDir, oldLog), "old");

		const files = await collectLogFiles({ proxyLogDir: proxyDir }, logger);

		expect(Object.keys(files)).toEqual([`vscode-logs/proxy/${recentLog}`]);
	});

	it("skips missing or unreadable sources and collects the rest", async () => {
		const proxyDir = path.join(tmpDir, "proxy");
		await fs.mkdir(proxyDir);
		await fs.writeFile(path.join(proxyDir, "good.log"), "ok");
		await fs.writeFile(path.join(proxyDir, "bad.log"), "secret");
		await fs.chmod(path.join(proxyDir, "bad.log"), 0o000);

		const files = await collectLogFiles(
			{
				remoteSshLogPath: path.join(tmpDir, "nonexistent.log"),
				proxyLogDir: proxyDir,
				extensionLogDir: path.join(tmpDir, "no-such-dir"),
			},
			logger,
		);

		expect(Object.keys(files)).toEqual(["vscode-logs/proxy/good.log"]);

		await fs.chmod(path.join(proxyDir, "bad.log"), 0o644);
	});
});

describe("appendVsCodeLogs", () => {
	let zipPath: string;
	let originalZipBytes: Uint8Array;

	beforeEach(async () => {
		zipPath = path.join(tmpDir, "coder-support-123.zip");
		originalZipBytes = zipSync({ "server/info.txt": strToU8("server data") });
		await fs.writeFile(zipPath, originalZipBytes);
	});

	it("merges log files into the existing zip", async () => {
		const logPath = path.join(tmpDir, "ssh.log");
		await fs.writeFile(logPath, "ssh content");

		await appendVsCodeLogs(zipPath, { remoteSshLogPath: logPath }, logger);

		const zip = unzipSync(new Uint8Array(await fs.readFile(zipPath)));
		expect(Buffer.from(zip["server/info.txt"]).toString()).toBe("server data");
		expect(Buffer.from(zip["vscode-logs/remote-ssh/ssh.log"]).toString()).toBe(
			"ssh content",
		);
	});

	it("does not touch the zip when no logs are found", async () => {
		await appendVsCodeLogs(zipPath, {}, logger);

		const data = new Uint8Array(await fs.readFile(zipPath));
		expect(Buffer.from(data)).toEqual(Buffer.from(originalZipBytes));
	});

	it("leaves the original zip intact when it is corrupted", async () => {
		await fs.writeFile(zipPath, "not a zip");

		const logPath = path.join(tmpDir, "ssh.log");
		await fs.writeFile(logPath, "content");

		await appendVsCodeLogs(zipPath, { remoteSshLogPath: logPath }, logger);

		expect(await fs.readFile(zipPath, "utf-8")).toBe("not a zip");
	});
});
