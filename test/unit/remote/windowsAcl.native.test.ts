import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, onTestFinished } from "vitest";

import { SshConfig, type SshValues } from "@/remote/sshConfig";
import { system32, WINDOWS_ACL } from "@/remote/windowsAcl";

import { createMockLogger } from "../../mocks/testHelpers";

import type { Logger } from "@/logging/logger";

const execFile = promisify(execFileCallback);
const GUESTS_SID = "S-1-5-32-546";
const GUESTS_ALIAS = "BG";

// Real icacls and ssh, no mocks. Needs the Windows OpenSSH client. Run it
// without elevation as well as in CI to catch privilege assumptions.
describe.runIf(process.platform === "win32")(
	"Windows SSH config ACL repair",
	() => {
		it(
			"repairs the directory and every fragment so OpenSSH accepts them",
			{ timeout: 45_000 },
			async () => {
				const { root, logger } = await nativeFixture();
				const directory = path.join(root, "coder.coder-remote", "ssh");
				const userConfig = path.join(root, "config");
				const current = path.join(directory, "current.conf");
				const other = path.join(directory, "other.conf");
				const host = "coder-acl-current";
				await fs.mkdir(directory, { recursive: true });
				await fs.writeFile(
					userConfig,
					`Include "${directory.replaceAll("\\", "/")}/*.conf"\n`,
				);
				await fs.writeFile(current, renderConfig(host, "unsafe-user"));
				await fs.writeFile(other, renderConfig("coder-acl-other", "other"));

				// A fragment Guests can reach makes OpenSSH refuse the whole include.
				// One inherits the grant, the other blocks inheritance and keeps its
				// own, which the directory repair alone would miss.
				await grant(directory, GUESTS_SID, "(OI)(CI)(F)");
				await grant(current, GUESTS_SID, "(F)");
				await execFile(system32("icacls.exe"), [other, "/inheritancelevel:d"]);
				await grant(other, GUESTS_SID, "(F)");
				const rootBefore = await savedAcl(root);
				const userConfigBefore = await savedAcl(userConfig);
				await expect(resolve(userConfig, host)).rejects.toMatchObject({
					stderr: expect.stringContaining("Bad owner or permissions"),
				});

				await managed(current, logger).update(sshValues(host, "repaired"));

				expect(await resolve(userConfig, host)).toContain(
					"proxycommand repaired",
				);
				expect(await savedAcl(directory)).not.toContain(GUESTS_ALIAS);
				for (const fragment of [current, other]) {
					const acl = await savedAcl(fragment);
					expect(acl).toContain("A;ID;");
					expect(acl).not.toContain(GUESTS_ALIAS);
				}
				expect(logger.warn).not.toHaveBeenCalled();
				expect(await savedAcl(root)).toBe(rootBefore);
				expect(await savedAcl(userConfig)).toBe(userConfigBefore);

				// /inheritance:r keeps a later parent grant out of the directory.
				const repaired = await savedAcl(directory);
				await grant(root, GUESTS_SID, "(OI)(CI)(F)");
				expect(await savedAcl(root)).not.toBe(rootBefore);
				expect(await savedAcl(directory)).toBe(repaired);

				// Reconnecting still rewrites the file the repair locked down.
				await managed(current, logger).update(sshValues(host, "rewritten"));
				expect(await resolve(userConfig, host)).toContain(
					"proxycommand rewritten",
				);
				expect(await savedAcl(directory)).toBe(repaired);
				expect(logger.warn).not.toHaveBeenCalled();
			},
		);

		interface UnsafeEntryCase {
			name: string;
			/** Adds the unsafe entry and names extra paths that must not change. */
			create: (directory: string, root: string) => Promise<string[]>;
		}
		it.each<UnsafeEntryCase>([
			{
				name: "a hard link to a file outside it",
				create: async (directory, root) => {
					const external = path.join(root, "external.conf");
					await fs.writeFile(external, "# external");
					await fs.link(external, path.join(directory, "linked.conf"));
					return [external];
				},
			},
			{
				name: "a directory matching *.conf",
				create: async (directory) => {
					await fs.mkdir(path.join(directory, "folder.conf"));
					return [];
				},
			},
		])(
			"refuses to write when the managed directory holds $name",
			async ({ create }) => {
				const { root, logger } = await nativeFixture();
				const directory = path.join(root, "managed");
				const current = path.join(directory, "current.conf");
				await fs.mkdir(directory);
				await fs.writeFile(current, "# unchanged");
				const watched = [
					directory,
					current,
					...(await create(directory, root)),
				];
				await grant(directory, GUESTS_SID, "(OI)(CI)(F)");
				const before = await Promise.all(watched.map(savedAcl));

				await expect(
					managed(current, logger).update(sshValues("coder-unsafe", "unsafe")),
				).rejects.toThrow();

				expect(await Promise.all(watched.map(savedAcl))).toEqual(before);
				expect(await fs.readFile(current, "utf8")).toBe("# unchanged");
				expect(
					(await fs.readdir(directory)).filter((name) =>
						name.includes("vscode-coder-tmp"),
					),
				).toEqual([]);
			},
		);

		it.each([
			{
				name: "a directory junction",
				create: async (root: string) => {
					const target = path.join(root, "junction target");
					const candidate = path.join(root, "junction");
					await fs.mkdir(target);
					await fs.symlink(target, candidate, "junction");
					return { candidate, unchanged: target };
				},
			},
			{
				name: "a regular file",
				create: async (root: string) => {
					const candidate = path.join(root, "not a directory");
					await fs.writeFile(candidate, "unchanged");
					return { candidate, unchanged: candidate };
				},
			},
		])("rejects $name as the managed directory", async ({ create }) => {
			const { root } = await nativeFixture();
			const { candidate, unchanged } = await create(root);
			const before = await savedAcl(unchanged);

			await expect(WINDOWS_ACL.prepareDirectory(candidate)).rejects.toThrow();
			expect(await savedAcl(unchanged)).toBe(before);
		});
	},
);

const managed = (filePath: string, logger: Logger) =>
	new SshConfig(filePath, logger, undefined, WINDOWS_ACL);

async function nativeFixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "coder acl é space-"));
	onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
	return { root, logger: createMockLogger() };
}

function sshValues(host: string, proxyCommand: string): SshValues {
	return {
		Host: host,
		ProxyCommand: proxyCommand,
		ConnectTimeout: "0",
		StrictHostKeyChecking: "no",
		UserKnownHostsFile: "NUL",
		LogLevel: "ERROR",
		ServerAliveInterval: "10",
		ServerAliveCountMax: "3",
	};
}

const renderConfig = (host: string, proxyCommand: string) =>
	`Host ${host}\n  ProxyCommand ${proxyCommand}\n`;

/** Dump a path's ACL so a test can compare it before and after a repair. */
async function savedAcl(pathname: string): Promise<string> {
	const backup = path.join(os.tmpdir(), `coder-acl-${randomUUID()}.txt`);
	try {
		await execFile(system32("icacls.exe"), [pathname, "/save", backup]);
		return await fs.readFile(backup, "utf16le");
	} finally {
		await fs.rm(backup, { force: true });
	}
}

/** Resolve a host through the user's config to prove OpenSSH reads the include. */
async function resolve(userConfig: string, host: string): Promise<string> {
	const { stdout } = await execFile(system32("OpenSSH/ssh.exe"), [
		"-G",
		"-F",
		userConfig,
		host,
	]);
	return stdout;
}

const grant = (pathname: string, sid: string, permissions: string) =>
	execFile(system32("icacls.exe"), [
		pathname,
		"/grant",
		`*${sid}:${permissions}`,
	]);
