import { execFile as execFileCallback } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { SshConfig, type SshValues } from "@/remote/sshConfig";
import { WindowsAcl } from "@/remote/windowsAcl";

import type { Logger } from "@/logging/logger";

const execFile = promisify(execFileCallback);
const enabled =
	process.platform === "win32" && process.env.CODER_WINDOWS_ACL_TEST === "1";
const logger: Logger = {
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	show: () => {},
};

const sshValues = (host: string, proxyCommand: string): SshValues => ({
	Host: host,
	ProxyCommand: proxyCommand,
	ConnectTimeout: "0",
	StrictHostKeyChecking: "no",
	UserKnownHostsFile: "NUL",
	LogLevel: "ERROR",
	ServerAliveInterval: "10",
	ServerAliveCountMax: "3",
});

function windowsExecutable(name: string): string {
	const systemRoot = process.env.SystemRoot;
	if (!systemRoot) {
		throw new Error("SystemRoot is required for Windows ACL native tests");
	}
	return path.join(systemRoot, "System32", name);
}

async function savedAcl(pathname: string): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "coder-acl-save-"));
	try {
		const backup = path.join(directory, "acl.txt");
		await execFile(windowsExecutable("icacls.exe"), [
			pathname,
			"/save",
			backup,
		]);
		return await fs.readFile(backup, "utf16le");
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}

async function resolve(parentConfig: string, host: string): Promise<string> {
	const { stdout } = await execFile(windowsExecutable("OpenSSH/ssh.exe"), [
		"-G",
		"-F",
		parentConfig,
		host,
	]);
	return stdout;
}

async function currentUserSid(): Promise<string> {
	const { stdout } = await execFile(windowsExecutable("whoami.exe"), [
		"/user",
		"/fo",
		"csv",
		"/nh",
	]);
	const sid = /,"(S-\d+(?:-\d+)+)"\s*$/.exec(stdout)?.[1];
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
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), "coder-acl-fixture-"),
	);
	try {
		const backup = path.join(directory, "acl.txt");
		const flags = inherit ? "OICI" : "";
		await fs.writeFile(
			backup,
			`\uFEFF${path.basename(pathname)}\r\nD:P(A;${flags};FA;;;${userSid})(A;${flags};FA;;;${sid})\r\n`,
			"utf16le",
		);
		await execFile(windowsExecutable("icacls.exe"), [
			path.dirname(pathname),
			"/restore",
			backup,
		]);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}

const test = it.extend("root", async ({ task: _task }, { onCleanup }) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "coder-acl-test-"));
	onCleanup(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});
	return root;
});

const targetTypes = [
	[
		"directory",
		async (root: string): Promise<[string, string]> => {
			const target = path.join(root, "directory");
			await fs.mkdir(target);
			return [target, target];
		},
	],
	[
		"directory junction",
		async (root: string): Promise<[string, string]> => {
			const target = path.join(root, "junction-target");
			const junction = path.join(root, "junction");
			await fs.mkdir(target);
			await fs.symlink(target, junction, "junction");
			return [junction, target];
		},
	],
	[
		"hard-linked file",
		async (root: string): Promise<[string, string]> => {
			const target = path.join(root, "external.conf");
			const link = path.join(root, "linked.conf");
			await fs.writeFile(target, "external");
			await fs.link(target, link);
			return [link, target];
		},
	],
] as const;

// These tests exercise Windows OpenSSH, icacls, and whoami. They deliberately
// fail when enabled if any dependency is absent.
describe.runIf(enabled)("Windows SSH config ACL repair", () => {
	for (const [name, createTarget] of targetTypes) {
		test(`rejects a ${name} without changing its target`, async ({ root }) => {
			const [target, unchanged] = await createTarget(root);
			const before = await savedAcl(unchanged);

			await expect(
				new WindowsAcl(path.resolve("scripts/windows-acl.js")).secure(target),
			).rejects.toThrow();
			expect(await savedAcl(unchanged)).toBe(before);
		});
	}

	for (const [name, sid, savedSid] of [
		["Everyone", "S-1-1-0", "WD"],
		[
			"unrelated numeric SID",
			"S-1-5-21-111111111-222222222-333333333-4444",
			"S-1-5-21-111111111-222222222-333333333-4444",
		],
	] as const) {
		test(`repairs inherited directory and explicit sibling ${name} access without changing the directory or main config`, async ({
			root,
		}) => {
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
			await grantAccess(includeDirectory, userSid, sid, true);
			await grantAccess(otherConfig, userSid, sid);
			const directoryBefore = await savedAcl(includeDirectory);
			const parentBefore = await savedAcl(parentConfig);
			expect(directoryBefore).toContain(savedSid);
			expect(await savedAcl(otherConfig)).toContain(savedSid);
			await expect(resolve(parentConfig, currentHost)).rejects.toMatchObject({
				stderr: expect.stringMatching(/Bad owner or permissions/),
			});

			const config = new SshConfig(
				currentConfig,
				logger,
				undefined,
				new WindowsAcl(path.resolve("scripts/windows-acl.js")),
			);
			for (const user of ["repaired-user", "rewritten-user"]) {
				await config.update(sshValues(currentHost, user));
				expect(await resolve(parentConfig, currentHost)).toContain(
					`proxycommand ${user}`,
				);
				expect(await savedAcl(otherConfig)).not.toContain(savedSid);
				expect(await savedAcl(includeDirectory)).toBe(directoryBefore);
				expect(await savedAcl(parentConfig)).toBe(parentBefore);
			}
		}, 60_000);
	}

	test("fails on a linked sibling without changing its external file or directory", async ({
		root,
	}) => {
		const includeDirectory = path.join(root, "coder");
		const external = path.join(root, "external.conf");
		const linkedSibling = path.join(includeDirectory, "linked.conf");
		const currentConfig = path.join(includeDirectory, "current.conf");
		await fs.mkdir(includeDirectory);
		await fs.writeFile(external, "external");
		await fs.link(external, linkedSibling);
		const externalBefore = await savedAcl(external);
		const directoryBefore = await savedAcl(includeDirectory);

		await expect(
			new SshConfig(
				currentConfig,
				logger,
				undefined,
				new WindowsAcl(path.resolve("scripts/windows-acl.js")),
			).update(sshValues("coder-acl-linked", "linked-user")),
		).rejects.toThrow();
		expect(await savedAcl(external)).toBe(externalBefore);
		expect(await savedAcl(includeDirectory)).toBe(directoryBefore);
	});
});
