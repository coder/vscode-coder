import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import {
	getHomeSshConfigPath,
	getMsysHomeDir,
	SshConfig,
	type SshValues,
} from "@/remote/sshConfig";

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
	// writes under the home directory anyway.
	const root = process.platform === "win32" ? os.homedir() : os.tmpdir();
	tempDir = await fs.mkdtemp(path.join(root, "coder-ssh-test-"));
	const logger = createMockLogger();
	const includeDir = path.join(tempDir, includeDirName);
	const userConfigPath = path.join(tempDir, "config");

	return {
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

	// Brackets and % are legal in file names on every platform, unlike * and ?.
	// OpenSSH 9.9+ expands %d to the home directory in Include arguments.
	it(
		"honors glob characters and % in the include path",
		async () => {
			const ssh = await createFixture("we[i]rd 50%d [dir]");
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
});

const windowsSshBuilds =
	process.platform === "win32"
		? [
				`${process.env.SystemRoot}\\System32\\OpenSSH\\ssh.exe`,
				`${process.env.ProgramFiles}\\Git\\usr\\bin\\ssh.exe`,
			].filter((ssh) => existsSync(ssh))
		: [];
const gitSsh = windowsSshBuilds.find((ssh) => ssh.includes("Git"));

type HomeEnv = Partial<Record<"HOME" | "HOMEDRIVE" | "HOMEPATH", string>>;

/** Sets exactly the given home variables, unsetting the others. */
function stubHomeEnv(env: HomeEnv): void {
	for (const name of ["HOME", "HOMEDRIVE", "HOMEPATH"] as const) {
		vi.stubEnv(name, env[name]);
	}
}

/** `C:\dir` as Windows sets it for a domain home folder: `C:` and `\dir`. */
function homeDriveEnv(dir: string): HomeEnv {
	return { HOMEDRIVE: dir.slice(0, 2), HOMEPATH: dir.slice(2) };
}

interface HomeCase {
	sshPath: string;
	name: string;
	/** The home variables to set, given the fixture directory holding the include. */
	env: (fixtureDir: string) => HomeEnv;
}

// Windows OpenSSH expands ~ from HOME, else the profile. Git for Windows falls
// back to HOMEDRIVE and HOMEPATH, which a domain home folder such as H:\ sets.
describe.skipIf(windowsSshBuilds.length === 0)(
	"include resolution by each Windows ssh build",
	() => {
		const elsewhere = () => path.join(os.tmpdir(), "elsewhere");
		it.each<HomeCase>(
			windowsSshBuilds.flatMap((sshPath) => [
				{ sshPath, name: "nothing", env: () => ({}) },
				{
					sshPath,
					name: "HOME at the profile",
					env: () => ({ HOME: os.homedir() }),
				},
				{
					sshPath,
					name: "HOME elsewhere",
					env: () => ({ HOME: elsewhere() }),
				},
				{
					sshPath,
					name: "HOME holding the include",
					env: (dir) => ({ HOME: dir }),
				},
				{
					sshPath,
					name: "HOMEDRIVE and HOMEPATH elsewhere",
					env: () => homeDriveEnv(elsewhere()),
				},
				{
					sshPath,
					name: "HOMEDRIVE and HOMEPATH holding the include",
					env: homeDriveEnv,
				},
				{
					sshPath,
					name: "HOME at the profile and HOMEDRIVE elsewhere",
					env: () => ({ HOME: os.homedir(), ...homeDriveEnv(elsewhere()) }),
				},
			]),
		)(
			"$sshPath reads the include with $name",
			async ({ sshPath, env }) => {
				const ssh = await createFixture("Code Dir");
				stubHomeEnv(env(path.dirname(ssh.includeDir)));
				await ssh.connect("dev.coder.com", "echo dev-wins");
				expect(
					await ssh.resolve("coder-vscode.dev.coder.com--user--ws", sshPath),
				).toContain("proxycommand echo dev-wins");
			},
			TEST_TIMEOUT_MS,
		);

		// Without -F, Remote-SSH's default, Git ssh reads only ~/.ssh/config.
		it.runIf(gitSsh).each<{ name: string; env: (home: string) => HomeEnv }>([
			{ name: "HOME", env: (home) => ({ HOME: home }) },
			{ name: "HOMEDRIVE and HOMEPATH", env: homeDriveEnv },
		])(
			"Git for Windows ssh reads the include from its home set by $name",
			async ({ env }) => {
				const ssh = await createFixture("Code Dir");
				const home = path.join(path.dirname(ssh.includeDir), "home");
				stubHomeEnv(env(home));
				await ssh.connect("dev.coder.com", "echo dev-wins");
				const configPath = getHomeSshConfigPath(await getMsysHomeDir());
				expect(configPath).toBe(path.join(home, ".ssh", "config"));
				await new SshConfig(configPath!, createMockLogger()).updateInclude(
					ssh.includeDir,
					"dev.coder.com",
				);
				const { stdout } = await run(
					gitSsh!,
					["-G", "--", "coder-vscode.dev.coder.com--user--ws"],
					{ timeout: 10_000 },
				);
				expect(stdout).toContain("proxycommand echo dev-wins");
			},
			TEST_TIMEOUT_MS,
		);

		it("treats HOME reaching the profile through a junction as the profile", async () => {
			// A unique parent, so a killed run never blocks the next one.
			const parent = await fs.mkdtemp(path.join(os.tmpdir(), "coder-home-"));
			const junction = path.join(parent, "home");
			await fs.symlink(os.homedir(), junction, "junction");
			// rmdir removes the junction itself, never the profile behind it.
			onTestFinished(async () => {
				await fs.rmdir(junction);
				await fs.rmdir(parent);
			});
			vi.stubEnv("HOME", junction.toUpperCase());
			expect(getHomeSshConfigPath(await getMsysHomeDir())).toBeUndefined();
		});
	},
);
