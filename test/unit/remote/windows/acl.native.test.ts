import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, onTestFinished } from "vitest";

import { SshConfig, type SshValues } from "@/remote/sshConfig";
import { system32, WindowsAcl } from "@/remote/windows/acl";
import { parseWhoamiUserSid } from "@/remote/windows/aclFormat";

import { createMockLogger } from "../../../mocks/testHelpers";

import type { Logger } from "@/logging/logger";

const execFile = promisify(execFileCallback);
const EXTENSION_PATH = path.resolve(".");
const SCRIPT_PATH = path.join(EXTENSION_PATH, "assets/wsh/acl.js");

// Real icacls, cscript, and ssh, no mocks. Needs the OpenSSH client.
describe.runIf(process.platform === "win32")(
	"Windows SSH config ACL repair",
	() => {
		interface UnsafeTargetCase {
			name: string;
			createTarget: (root: string) => Promise<[string, string]>;
		}
		it.each<UnsafeTargetCase>([
			{
				name: "directory junction",
				createTarget: async (root) => {
					const target = path.join(root, "junction-target");
					const junction = path.join(root, "junction");
					await fs.mkdir(target);
					await fs.symlink(target, junction, "junction");
					return [junction, target];
				},
			},
			{
				name: "hard-linked file",
				createTarget: async (root) => {
					const target = path.join(root, "external.conf");
					const link = path.join(root, "linked.conf");
					await fs.writeFile(target, "external");
					await fs.link(target, link);
					return [link, target];
				},
			},
		])(
			"rejects a $name without changing its target",
			async ({ createTarget }) => {
				const { root } = await nativeFixture();
				const [target, unchanged] = await createTarget(root);
				const before = await savedAcl(unchanged);

				await expect(
					new WindowsAcl(EXTENSION_PATH).secure(target),
				).rejects.toThrow();
				expect(await savedAcl(unchanged)).toBe(before);
			},
		);

		it(
			"repairs inherited directory and explicit sibling access without changing the directory or main config",
			{ timeout: 60_000 },
			async () => {
				const everyone = "S-1-1-0";
				const everyoneAlias = "WD";
				const { root, logger } = await nativeFixture();
				const includeDirectory = path.join(root, "coder");
				const parentConfig = path.join(root, "config");
				const currentConfig = path.join(includeDirectory, "current.conf");
				const otherConfig = path.join(includeDirectory, "other.conf");
				const currentHost = "coder-acl-current";
				await fs.mkdir(includeDirectory);
				await fs.writeFile(
					parentConfig,
					`Include "${includeDirectory.replaceAll("\\", "/")}/*.conf"\n`,
				);
				await new SshConfig(currentConfig, logger).update(
					sshValues(currentHost, "ordinary-user"),
				);
				await new SshConfig(otherConfig, logger).update(
					sshValues("coder-acl-other", "other-user"),
				);

				expect(await resolve(parentConfig, currentHost)).toContain(
					"proxycommand ordinary-user",
				);

				const userSid = await currentUserSid();
				await grantAccess(includeDirectory, userSid, everyone, true);
				await grantAccess(otherConfig, userSid, everyone);
				const directoryBefore = await savedAcl(includeDirectory);
				const parentBefore = await savedAcl(parentConfig);
				expect(directoryBefore).toContain(everyoneAlias);
				expect(await savedAcl(otherConfig)).toContain(everyoneAlias);
				await expect(resolve(parentConfig, currentHost)).rejects.toMatchObject({
					stderr: expect.stringContaining("Bad owner or permissions"),
				});

				// The second pass rewrites an already-repaired file, covering the
				// skip-when-correct path with siblings present.
				const config = managed(currentConfig, logger);
				for (const user of ["repaired-user", "rewritten-user"]) {
					await config.update(sshValues(currentHost, user));
					expect(await resolve(parentConfig, currentHost)).toContain(
						`proxycommand ${user}`,
					);
					expect(await savedAcl(otherConfig)).not.toContain(everyoneAlias);
					expect(await savedAcl(includeDirectory)).toBe(directoryBefore);
					expect(await savedAcl(parentConfig)).toBe(parentBefore);
				}
			},
		);

		it("skips a linked sibling without changing its external file or directory", async () => {
			const { root, logger } = await nativeFixture();
			const includeDirectory = path.join(root, "coder");
			const external = path.join(root, "external.conf");
			const linkedSibling = path.join(includeDirectory, "linked.conf");
			const currentConfig = path.join(includeDirectory, "current.conf");
			await fs.mkdir(includeDirectory);
			await fs.writeFile(external, "# external");
			await fs.link(external, linkedSibling);
			const externalBefore = await savedAcl(external);
			const directoryBefore = await savedAcl(includeDirectory);

			await managed(currentConfig, logger).update(
				sshValues("coder-acl-linked", "linked-user"),
			);
			expect(await fs.readFile(currentConfig, "utf8")).toContain("linked-user");
			expect(await fs.readFile(external, "utf8")).toBe("# external");
			expect(await savedAcl(external)).toBe(externalBefore);
			expect(await savedAcl(includeDirectory)).toBe(directoryBefore);
		});

		it("rejects an included .conf directory that prevents OpenSSH from reading the config", async () => {
			const { root, logger } = await nativeFixture();
			const directory = path.join(root, "folder.conf");
			const current = path.join(root, "current.conf");
			const parent = path.join(root, "config");
			await fs.mkdir(directory);
			await fs.writeFile(
				parent,
				`Include "${root.replaceAll("\\", "/")}/*.conf"\n`,
			);
			const before = await savedAcl(directory);
			await expect(resolve(parent, "coder-directory")).rejects.toMatchObject({
				stderr: expect.stringContaining("folder.conf: Permission denied"),
			});
			await expect(
				managed(current, logger).update(
					sshValues("coder-directory", "directory-user"),
				),
			).rejects.toThrow("Move or rename it");
			expect(await savedAcl(directory)).toBe(before);
			await fs.rename(directory, path.join(root, "folder"));
			await managed(current, logger).update(
				sshValues("coder-directory", "directory-user"),
			);
			expect(await resolve(parent, "coder-directory")).toContain(
				"proxycommand directory-user",
			);
		});

		it("still writes a usable config when the script cannot run", async () => {
			const { root, logger } = await nativeFixture();
			const current = path.join(root, "current.conf");
			await managed(
				current,
				logger,
				path.join(root, "missing-extension"),
			).update(sshValues("coder-unavailable", "unavailable-user"));
			expect(await resolve(current, "coder-unavailable")).toContain(
				"proxycommand unavailable-user",
			);
			expect(
				(await fs.readdir(root)).filter((name) =>
					name.includes("vscode-coder-tmp"),
				),
			).toEqual([]);
		});

		interface ScriptArgumentsCase {
			name: string;
			args: string[];
			message: string;
		}
		it.each<ScriptArgumentsCase>([
			{
				name: "no arguments",
				args: [],
				message: "Expected a file path and user SID",
			},
			{
				name: "an invalid SID",
				args: ["unused.conf", "S-1-invalid"],
				message: "Invalid Windows user SID",
			},
		])("rejects $name", async ({ args, message }) => {
			const script = ["//nologo", "//B", "//E:JScript", SCRIPT_PATH, ...args];
			await expect(
				execFile(system32("cscript.exe"), script),
			).rejects.toMatchObject({
				code: 1,
				stderr: expect.stringContaining(message),
			});
		});
	},
);

/** A managed config backed by the real Windows ACL repair. */
const managed = (
	filePath: string,
	logger: Logger,
	extension = EXTENSION_PATH,
) => new SshConfig(filePath, logger, undefined, new WindowsAcl(extension));

async function nativeFixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "coder acl é & test-"));
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

async function withAclBackup<T>(
	callback: (backup: string) => Promise<T>,
): Promise<T> {
	const backup = path.join(os.tmpdir(), `coder-acl-${randomUUID()}.txt`);
	try {
		return await callback(backup);
	} finally {
		await fs.rm(backup, { force: true });
	}
}

async function savedAcl(pathname: string): Promise<string> {
	return withAclBackup(async (backup) => {
		await execFile(system32("icacls.exe"), [pathname, "/save", backup]);
		return await fs.readFile(backup, "utf16le");
	});
}

/** Resolves an SSH host using the supplied OpenSSH configuration. */
async function resolve(parentConfig: string, host: string): Promise<string> {
	return (
		await execFile(system32("OpenSSH/ssh.exe"), [
			"-G",
			"-F",
			parentConfig,
			host,
		])
	).stdout;
}

/** Returns the SID reported for the current Windows user. */
async function currentUserSid(): Promise<string> {
	const args = ["/user", "/fo", "csv", "/nh"];
	const { stdout } = await execFile(system32("whoami.exe"), args);
	const sid = parseWhoamiUserSid(stdout);
	if (!sid) {
		throw new Error("Could not determine the current Windows user SID");
	}
	return sid;
}

async function grantAccess(
	pathname: string,
	userSid: string,
	sid: string,
	inherit = false,
): Promise<void> {
	await withAclBackup(async (backup) => {
		const flags = inherit ? "OICI" : "";
		await fs.writeFile(
			backup,
			`\uFEFF${path.basename(pathname)}\r\nD:P(A;${flags};FA;;;${userSid})(A;${flags};FA;;;${sid})\r\n`,
			"utf16le",
		);
		await execFile(system32("icacls.exe"), [
			path.dirname(pathname),
			"/restore",
			backup,
		]);
	});
}
