import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	collectSupportLogFiles,
	collectWindowLogDirs,
	resolveLogContext,
} from "@/supportBundle/logFiles";

import { createMockLogger } from "../../mocks/testHelpers";

// chmod to 0o000 is a no-op as root and on Windows.
const canTestUnreadable =
	process.getuid?.() !== 0 && process.platform !== "win32";

let tmpDir: string;
const logger = createMockLogger();

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "support-bundle-logs-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

async function setAge(filePath: string, daysAgo: number): Promise<void> {
	const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
	await fs.utimes(filePath, past, past);
}

async function collectTextFiles(
	sources: Parameters<typeof collectSupportLogFiles>[0],
): Promise<Record<string, string>> {
	const files = await collectSupportLogFiles(sources, logger);
	return Object.fromEntries(
		[...files].map(([name, data]) => [name, Buffer.from(data).toString()]),
	);
}

describe("collectSupportLogFiles", () => {
	it("collects active proxy log under its real name alongside Coder SSH proxy logs", async () => {
		const proxyDir = path.join(tmpDir, "proxy");
		await fs.mkdir(proxyDir);
		const activeProxyLog = path.join(tmpDir, "custom-active.log");
		await fs.writeFile(activeProxyLog, "active");
		await fs.writeFile(path.join(proxyDir, "coder-ssh-recent.log"), "recent");
		await fs.writeFile(path.join(proxyDir, "coder-ssh-old.log"), "old");
		await fs.writeFile(path.join(proxyDir, "12345.log"), "pid-style");
		await fs.writeFile(path.join(proxyDir, "other.log"), "other");
		await fs.writeFile(path.join(proxyDir, "secret.env"), "secret");
		await fs.mkdir(path.join(proxyDir, "subdir"));
		await setAge(path.join(proxyDir, "coder-ssh-old.log"), 5);

		await expect(
			collectTextFiles({
				activeProxyLogPath: activeProxyLog,
				proxyLogDir: proxyDir,
			}),
		).resolves.toEqual({
			"vscode-logs/proxy/custom-active.log": "active",
			"vscode-logs/proxy/coder-ssh-recent.log": "recent",
			"vscode-logs/proxy/12345.log": "pid-style",
		});
	});

	it("does not double-bundle the active proxy log when it lives inside proxyLogDir", async () => {
		const proxyDir = path.join(tmpDir, "proxy");
		await fs.mkdir(proxyDir);
		const activeProxyLog = path.join(proxyDir, "coder-ssh-active.log");
		await fs.writeFile(activeProxyLog, "active");

		const result = await collectTextFiles({
			activeProxyLogPath: activeProxyLog,
			proxyLogDir: proxyDir,
		});

		expect(result).toEqual({
			"vscode-logs/proxy/coder-ssh-active.log": "active",
		});
	});

	it("collects recent extension logs (including rotated .log.N) from a non-canonical extension log directory", async () => {
		const extDir = path.join(tmpDir, "ext");
		await fs.mkdir(extDir);
		await fs.writeFile(path.join(extDir, "Coder-recent.log"), "recent");
		await fs.writeFile(path.join(extDir, "Coder-recent.log.1"), "rotated");
		await fs.writeFile(path.join(extDir, "Coder-old.log"), "old");
		await fs.writeFile(path.join(extDir, "notes.txt"), "notes");
		await fs.mkdir(path.join(extDir, "subdir"));
		await setAge(path.join(extDir, "Coder-old.log"), 5);

		await expect(
			collectTextFiles({ extensionLogDir: extDir }),
		).resolves.toEqual({
			"vscode-logs/extension/Coder-recent.log": "recent",
			"vscode-logs/extension/Coder-recent.log.1": "rotated",
		});
	});

	it("collects extension and Remote-SSH logs across recent VS Code sessions", async () => {
		const logsRoot = path.join(tmpDir, "logs");
		const currentSession = "20240103T000000";
		const previousSession = "20240102T000000";
		const oldSession = "20231231T000000";
		const window = "window1";

		const currentExtDir = path.join(
			logsRoot,
			currentSession,
			window,
			"exthost",
			"coder.coder-remote",
		);
		const previousExtDir = path.join(
			logsRoot,
			previousSession,
			window,
			"exthost",
			"coder.coder-remote",
		);
		const oldExtDir = path.join(
			logsRoot,
			oldSession,
			window,
			"exthost",
			"coder.coder-remote",
		);
		await fs.mkdir(currentExtDir, { recursive: true });
		await fs.mkdir(previousExtDir, { recursive: true });
		await fs.mkdir(oldExtDir, { recursive: true });
		await fs.writeFile(path.join(currentExtDir, "Coder.log"), "current");
		await fs.writeFile(path.join(previousExtDir, "Coder.log"), "previous");
		await fs.writeFile(path.join(oldExtDir, "Coder.log"), "old");
		await setAge(path.join(oldExtDir, "Coder.log"), 5);

		const currentRemoteDir = path.join(
			logsRoot,
			currentSession,
			window,
			"output_logging_current",
		);
		const previousRemoteDir = path.join(
			logsRoot,
			previousSession,
			window,
			"output_logging_previous",
		);
		const oldRemoteDir = path.join(
			logsRoot,
			oldSession,
			window,
			"output_logging_old",
		);
		await fs.mkdir(currentRemoteDir, { recursive: true });
		await fs.mkdir(previousRemoteDir, { recursive: true });
		await fs.mkdir(oldRemoteDir, { recursive: true });
		await fs.writeFile(
			path.join(currentRemoteDir, "1-Remote - SSH.log"),
			"current ssh",
		);
		await fs.writeFile(
			path.join(previousRemoteDir, "1-Remote - SSH.log"),
			"previous ssh",
		);
		await fs.writeFile(
			path.join(oldRemoteDir, "1-Remote - SSH.log"),
			"old ssh",
		);
		await setAge(path.join(oldRemoteDir, "1-Remote - SSH.log"), 5);
		const future = new Date(Date.now() + 60_000);
		await fs.utimes(
			path.join(previousRemoteDir, "1-Remote - SSH.log"),
			future,
			future,
		);

		await expect(
			collectTextFiles({ extensionLogDir: currentExtDir }),
		).resolves.toEqual({
			[`vscode-logs/extension/${currentSession}/${window}/Coder.log`]:
				"current",
			[`vscode-logs/extension/${previousSession}/${window}/Coder.log`]:
				"previous",
			"vscode-logs/remote-ssh/1-Remote - SSH.log": "current ssh",
			[`vscode-logs/remote-ssh/${currentSession}/${window}/output_logging_current/1-Remote - SSH.log`]:
				"current ssh",
			[`vscode-logs/remote-ssh/${previousSession}/${window}/output_logging_previous/1-Remote - SSH.log`]:
				"previous ssh",
		});
	});

	it("collects Remote-SSH logs only for windows with Coder extension logs", async () => {
		const logsRoot = path.join(tmpDir, "logs");
		const currentExtDir = path.join(
			logsRoot,
			"20240101T000000",
			"window1",
			"exthost",
			"coder.coder-remote",
		);
		await fs.mkdir(currentExtDir, { recursive: true });
		await fs.writeFile(path.join(currentExtDir, "Coder.log"), "coder");
		const relatedRemoteDir = path.join(
			logsRoot,
			"20240101T000000",
			"window1",
			"output_logging_1",
		);
		const unrelatedRemoteDir = path.join(
			logsRoot,
			"20240101T000000",
			"window2",
			"output_logging_2",
		);
		await fs.mkdir(relatedRemoteDir, { recursive: true });
		await fs.mkdir(unrelatedRemoteDir, { recursive: true });
		await fs.writeFile(
			path.join(relatedRemoteDir, "1-Remote - SSH.log"),
			"related",
		);
		await fs.writeFile(
			path.join(unrelatedRemoteDir, "1-Remote - SSH.log"),
			"unrelated",
		);

		const files = await collectTextFiles({ extensionLogDir: currentExtDir });

		expect(files).toMatchObject({
			"vscode-logs/remote-ssh/1-Remote - SSH.log": "related",
			"vscode-logs/remote-ssh/20240101T000000/window1/output_logging_1/1-Remote - SSH.log":
				"related",
		});
		expect(
			files[
				"vscode-logs/remote-ssh/20240101T000000/window2/output_logging_2/1-Remote - SSH.log"
			],
		).toBeUndefined();
	});

	it("collects Remote-SSH logs from the host extension's exthost dir even when filenames lack 'Remote - SSH'", async () => {
		const logsRoot = path.join(tmpDir, "logs");
		const currentExtDir = path.join(
			logsRoot,
			"20240101T000000",
			"window1",
			"exthost",
			"coder.coder-remote",
		);
		await fs.mkdir(currentExtDir, { recursive: true });
		await fs.writeFile(path.join(currentExtDir, "Coder.log"), "coder");

		const remoteSshExtDir = path.join(
			logsRoot,
			"20240101T000000",
			"window1",
			"exthost",
			"ms-vscode-remote.remote-ssh",
		);
		await fs.mkdir(remoteSshExtDir, { recursive: true });
		await fs.writeFile(path.join(remoteSshExtDir, "1.log"), "ext-host-log");

		const files = await collectTextFiles({ extensionLogDir: currentExtDir });

		expect(files).toMatchObject({
			"vscode-logs/remote-ssh/20240101T000000/window1/exthost/ms-vscode-remote.remote-ssh/1.log":
				"ext-host-log",
		});
	});

	it("does not promote a stale log from another window when the current window has no Remote-SSH logs", async () => {
		const logsRoot = path.join(tmpDir, "logs");
		const currentSession = "20240103T000000";
		const otherSession = "20240102T000000";

		const currentExtDir = path.join(
			logsRoot,
			currentSession,
			"window1",
			"exthost",
			"coder.coder-remote",
		);
		const otherExtDir = path.join(
			logsRoot,
			otherSession,
			"window1",
			"exthost",
			"coder.coder-remote",
		);
		await fs.mkdir(currentExtDir, { recursive: true });
		await fs.mkdir(otherExtDir, { recursive: true });
		await fs.writeFile(path.join(currentExtDir, "Coder.log"), "current");
		await fs.writeFile(path.join(otherExtDir, "Coder.log"), "other");

		const otherSshDir = path.join(
			logsRoot,
			otherSession,
			"window1",
			"output_logging_1",
		);
		await fs.mkdir(otherSshDir, { recursive: true });
		await fs.writeFile(
			path.join(otherSshDir, "1-Remote - SSH.log"),
			"stale ssh",
		);

		const files = await collectTextFiles({ extensionLogDir: currentExtDir });

		expect(files["vscode-logs/remote-ssh/1-Remote - SSH.log"]).toBeUndefined();
		expect(
			files[
				`vscode-logs/remote-ssh/${otherSession}/window1/output_logging_1/1-Remote - SSH.log`
			],
		).toBe("stale ssh");
	});

	it("falls back to scanning the assumed window dir when the layout is non-canonical", async () => {
		const extDir = path.join(tmpDir, "ext");
		const siblingSshDir = path.join(tmpDir, "output_logging_1");
		await fs.mkdir(extDir);
		await fs.mkdir(siblingSshDir);
		await fs.writeFile(path.join(siblingSshDir, "1-Remote - SSH.log"), "ssh");
		await fs.writeFile(path.join(extDir, "Coder.log"), "coder");

		const files = await collectTextFiles({ extensionLogDir: extDir });

		expect(files).toMatchObject({
			"vscode-logs/extension/Coder.log": "coder",
			"vscode-logs/remote-ssh/output_logging_1/1-Remote - SSH.log": "ssh",
		});
	});

	it("resolves a forked Coder extension id via the same layout", async () => {
		const logsRoot = path.join(tmpDir, "logs");
		const currentExtDir = path.join(
			logsRoot,
			"20240101T000000",
			"window1",
			"exthost",
			"mycompany.coder-remote",
		);
		await fs.mkdir(currentExtDir, { recursive: true });
		await fs.writeFile(path.join(currentExtDir, "Coder.log"), "coder");

		const previousExtDir = path.join(
			logsRoot,
			"20240102T000000",
			"window1",
			"exthost",
			"mycompany.coder-remote",
		);
		await fs.mkdir(previousExtDir, { recursive: true });
		await fs.writeFile(path.join(previousExtDir, "Coder.log"), "previous");

		const files = await collectTextFiles({ extensionLogDir: currentExtDir });

		expect(files).toMatchObject({
			"vscode-logs/extension/20240101T000000/window1/Coder.log": "coder",
			"vscode-logs/extension/20240102T000000/window1/Coder.log": "previous",
		});
	});

	it.runIf(canTestUnreadable)(
		"skips missing or unreadable sources and includes readable files",
		async () => {
			const proxyDir = path.join(tmpDir, "proxy");
			await fs.mkdir(proxyDir);
			await fs.writeFile(path.join(proxyDir, "coder-ssh-good.log"), "ok");
			const badLog = path.join(proxyDir, "coder-ssh-bad.log");
			await fs.writeFile(badLog, "secret");
			await fs.chmod(badLog, 0o000);

			try {
				await expect(
					collectTextFiles({
						activeProxyLogPath: path.join(tmpDir, "nonexistent.log"),
						proxyLogDir: proxyDir,
						extensionLogDir: path.join(tmpDir, "no-such-dir"),
					}),
				).resolves.toEqual({
					"vscode-logs/proxy/coder-ssh-good.log": "ok",
				});
			} finally {
				await fs.chmod(badLog, 0o644);
			}
		},
	);
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

	it("accepts a forked Coder extension id provided the layout matches", () => {
		const extensionLogDir = path.join(
			tmpDir,
			"20240101T000000",
			"window1",
			"exthost",
			"mycompany.coder-remote",
		);

		expect(resolveLogContext(extensionLogDir)).toEqual({
			currentWindowPath: path.join(tmpDir, "20240101T000000", "window1"),
			logsRoot: tmpDir,
		});
	});

	it("does not treat a non-canonical session-suffix name as a session root", () => {
		const extensionLogDir = path.join(
			tmpDir,
			"20240101T000000-foo",
			"window1",
			"exthost",
			"coder.coder-remote",
		);

		expect(resolveLogContext(extensionLogDir)).toEqual({
			currentWindowPath: path.join(tmpDir, "20240101T000000-foo", "window1"),
			logsRoot: path.join(tmpDir, "20240101T000000-foo"),
		});
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
