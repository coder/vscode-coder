import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SshConfig, type SshValues } from "@/remote/sshConfig";

import { createMockLogger } from "../../mocks/testHelpers";

const run = promisify(execFile);
const sshAvailable = !spawnSync("ssh", ["-V"]).error;
// Generous for slow CI runners; each ssh -G call is local and fast.
const TEST_TIMEOUT_MS = 30_000;

const sshValues = (
	hostname: string,
	proxyCommand: string,
	editor = "vscode",
): SshValues => ({
	Host: `coder-${editor}.${hostname}--*`,
	ProxyCommand: proxyCommand,
	ConnectTimeout: "0",
	StrictHostKeyChecking: "no",
	UserKnownHostsFile: "/dev/null",
	PermitLocalCommand: "no",
	LogLevel: "ERROR",
	ServerAliveInterval: "10",
	ServerAliveCountMax: "3",
	SendEnv: "CODER_SSH_SESSION_TYPE",
});

let tempDir: string | undefined;

afterEach(async () => {
	vi.unstubAllEnvs();
	if (tempDir) {
		await fs.rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

/** Real files and the real ssh binary; only the editor plumbing is absent. */
async function createFixture(includeDirName: string) {
	// Windows tmpdir paths use 8.3 short names ssh cannot glob; the product
	// writes under the home directory anyway, emitted as a ~/... include.
	const root = process.platform === "win32" ? os.homedir() : os.tmpdir();
	tempDir = await fs.mkdtemp(path.join(root, "coder-ssh-test-"));
	const logger = createMockLogger();
	const includeDir = path.join(tempDir, includeDirName);
	const userConfigPath = path.join(tempDir, "config");

	return {
		tempDir,
		includeDir,
		/** What the extension does on connect: write our file, then include it. */
		async connect(hostname: string, proxyCommand: string, editor = "vscode") {
			const coderConfig = new SshConfig(
				path.join(includeDir, `${editor}--${hostname}.conf`),
				logger,
			);
			await coderConfig.update(sshValues(hostname, proxyCommand, editor));
			const userConfig = new SshConfig(userConfigPath, logger);
			await userConfig.load();
			await userConfig.updateInclude(includeDir, hostname);
		},
		async seedUserConfig(contents: string) {
			await fs.writeFile(userConfigPath, contents);
		},
		async appendUserConfig(contents: string) {
			await fs.appendFile(userConfigPath, contents);
		},
		/** The host's effective options according to the real ssh. */
		async resolve(host: string, ssh = "ssh") {
			const { stdout } = await run(ssh, ["-G", "-F", userConfigPath, host], {
				timeout: 10_000,
			});
			return stdout;
		},
	};
}

describe.skipIf(!sshAvailable)("include resolution by real OpenSSH", () => {
	it(
		"prefers the included file over a stale block and a later Host *",
		async () => {
			const ssh = await createFixture("Code Dir");
			await ssh.seedUserConfig(
				[
					"# --- START CODER VSCODE dev.coder.com ---",
					"Host coder-vscode.dev.coder.com--*",
					"  ProxyCommand echo stale-wins",
					"# --- END CODER VSCODE dev.coder.com ---",
					"",
				].join("\n"),
			);
			await ssh.connect("dev.coder.com", "echo dev-wins");
			await ssh.connect("eu.coder.com", "echo eu-wins");
			await ssh.connect("dev.coder.com", "echo cursor-wins", "cursor");
			await ssh.appendUserConfig(
				"\nHost *\n  ProxyCommand echo user-wins\n  ConnectTimeout 9\n",
			);

			const resolved = await ssh.resolve(
				"coder-vscode.dev.coder.com--user--ws",
			);
			expect(resolved).toContain("proxycommand echo dev-wins");
			expect(resolved).toContain("connecttimeout 0");
			expect(resolved).not.toContain("stale-wins");
			expect(
				await ssh.resolve("coder-vscode.eu.coder.com--user--ws"),
			).toContain("proxycommand echo eu-wins");
			expect(
				await ssh.resolve("coder-cursor.dev.coder.com--user--ws"),
			).toContain("proxycommand echo cursor-wins");
		},
		TEST_TIMEOUT_MS,
	);

	// Brackets are legal in file names on every platform, unlike * and ?.
	it(
		"honors escaped glob characters in the include path",
		async () => {
			const ssh = await createFixture("we[i]rd [dir]");
			await ssh.connect("dev.coder.com", "echo dev-wins");
			expect(
				await ssh.resolve("coder-vscode.dev.coder.com--user--ws"),
			).toContain("proxycommand echo dev-wins");
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"keeps ssh working when the included directory is deleted",
		async () => {
			const ssh = await createFixture("Code Dir");
			await ssh.connect("dev.coder.com", "echo dev-wins");
			await ssh.appendUserConfig("\nHost *\n  ProxyCommand echo user-wins\n");
			await fs.rm(ssh.includeDir, { recursive: true });

			expect(
				await ssh.resolve("coder-vscode.dev.coder.com--user--ws"),
			).toContain("proxycommand echo user-wins");
		},
		TEST_TIMEOUT_MS,
	);

	// OpenSSH 9.9+ expands %d to the home directory in Include arguments.
	it(
		"honors % in the include path",
		async () => {
			const ssh = await createFixture("50%d off");
			await ssh.connect("dev.coder.com", "echo dev-wins");
			expect(
				await ssh.resolve("coder-vscode.dev.coder.com--user--ws"),
			).toContain("proxycommand echo dev-wins");
		},
		TEST_TIMEOUT_MS,
	);
});

const windowsSshBuilds = [
	path.join(
		process.env.SystemRoot ?? "C:\\Windows",
		"System32\\OpenSSH\\ssh.exe",
	),
	path.join(
		process.env.ProgramFiles ?? "C:\\Program Files",
		"Git\\usr\\bin\\ssh.exe",
	),
].filter((ssh) => process.platform === "win32" && existsSync(ssh));

// Both builds expand ~ from HOME when it is set, and differ on which absolute
// Include paths they read.
describe.skipIf(windowsSshBuilds.length === 0)(
	"include resolution by each Windows ssh build",
	() => {
		type HomeCase = "unset" | "profile" | "elsewhere";
		const cases = windowsSshBuilds.flatMap((ssh) =>
			(["unset", "profile", "elsewhere"] as const).map(
				(home): [string, HomeCase] => [ssh, home],
			),
		);
		it.each(cases)(
			"%s reads the include with HOME %s",
			async (sshPath, home) => {
				const ssh = await createFixture("Code Dir");
				const homes: Record<HomeCase, string | undefined> = {
					unset: undefined,
					profile: os.homedir(),
					elsewhere: path.join(ssh.tempDir, "elsewhere"),
				};
				// ssh inherits the HOME the extension sees.
				vi.stubEnv("HOME", homes[home]);
				await ssh.connect("dev.coder.com", "echo dev-wins");
				expect(
					await ssh.resolve("coder-vscode.dev.coder.com--user--ws", sshPath),
				).toContain("proxycommand echo dev-wins");
			},
			TEST_TIMEOUT_MS,
		);
	},
);
