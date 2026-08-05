import { execFile, spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { SshConfig, type SshValues } from "@/remote/sshConfig";

import { createMockLogger } from "../../mocks/testHelpers";

const run = promisify(execFile);
const sshAvailable = !spawnSync("ssh", ["-V"]).error;
// Generous for slow CI runners; each ssh -G call is local and fast.
const TEST_TIMEOUT_MS = 30_000;

const sshValues = (hostname: string, proxyCommand: string): SshValues => ({
	Host: `coder-vscode.${hostname}--*`,
	ProxyCommand: proxyCommand,
	ConnectTimeout: "0",
	StrictHostKeyChecking: "no",
	UserKnownHostsFile: "/dev/null",
	LogLevel: "ERROR",
	ServerAliveInterval: "10",
	ServerAliveCountMax: "3",
});

let tempDir: string | undefined;

afterEach(async () => {
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
	const includePath = path.join(tempDir, includeDirName, "ssh-config");
	const userConfigPath = path.join(tempDir, "config");

	return {
		includePath,
		/** What the extension does on connect: write our file, then include it. */
		async connect(hostname: string, proxyCommand: string) {
			const coderConfig = new SshConfig(includePath, logger);
			await coderConfig.load();
			await coderConfig.update(hostname, sshValues(hostname, proxyCommand));
			const userConfig = new SshConfig(userConfigPath, logger);
			await userConfig.load();
			await userConfig.updateInclude({ id: "vscode", includePath }, hostname);
		},
		async seedUserConfig(contents: string) {
			await fs.writeFile(userConfigPath, contents);
		},
		async appendUserConfig(contents: string) {
			await fs.appendFile(userConfigPath, contents);
		},
		/** The host's effective options according to the real ssh. */
		async resolve(host: string) {
			const { stdout } = await run("ssh", ["-G", "-F", userConfigPath, host], {
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
		},
		TEST_TIMEOUT_MS,
	);

	// Windows forbids these characters in file names.
	it.skipIf(process.platform === "win32")(
		"honors escaped glob characters in the include path",
		async () => {
			const ssh = await createFixture("we[i]rd *dir?");
			await ssh.connect("dev.coder.com", "echo dev-wins");
			expect(
				await ssh.resolve("coder-vscode.dev.coder.com--user--ws"),
			).toContain("proxycommand echo dev-wins");
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"keeps ssh working when the included file is deleted",
		async () => {
			const ssh = await createFixture("Code Dir");
			await ssh.connect("dev.coder.com", "echo dev-wins");
			await ssh.appendUserConfig("\nHost *\n  ProxyCommand echo user-wins\n");
			await fs.rm(ssh.includePath);

			expect(
				await ssh.resolve("coder-vscode.dev.coder.com--user--ws"),
			).toContain("proxycommand echo user-wins");
		},
		TEST_TIMEOUT_MS,
	);
});
