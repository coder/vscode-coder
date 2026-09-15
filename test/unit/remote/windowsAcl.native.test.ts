import { execFile as execFileCallback } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { SshConfig, type SshValues } from "@/remote/sshConfig";
import { WindowsAcl } from "@/remote/windowsAcl";

import { createMockLogger } from "../../mocks/testHelpers";

const execFile = promisify(execFileCallback);
const enabled =
	process.platform === "win32" && process.env.CODER_WINDOWS_ACL_TEST === "1";
const scriptPath = path.resolve("scripts/windows-acl.js");

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

const test = it
	.extend("logger", () => createMockLogger())
	.extend("root", async ({ task: _task }, { onCleanup }) => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), "coder acl é & test-"),
		);
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

			await expect(new WindowsAcl(scriptPath).secure(target)).rejects.toThrow();
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
			logger,
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

			const config = SshConfig.createManaged(currentConfig, logger, scriptPath);
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

	test("skips a linked sibling without changing its external file or directory", async ({
		root,
		logger,
	}) => {
		const includeDirectory = path.join(root, "coder");
		const external = path.join(root, "external.conf");
		const linkedSibling = path.join(includeDirectory, "linked.conf");
		const currentConfig = path.join(includeDirectory, "current.conf");
		await fs.mkdir(includeDirectory);
		await fs.writeFile(external, "# external");
		await fs.link(external, linkedSibling);
		const externalBefore = await savedAcl(external);
		const directoryBefore = await savedAcl(includeDirectory);

		await SshConfig.createManaged(currentConfig, logger, scriptPath).update(
			sshValues("coder-acl-linked", "linked-user"),
		);
		expect(await fs.readFile(currentConfig, "utf8")).toContain("linked-user");
		expect(await fs.readFile(external, "utf8")).toBe("# external");
		expect(await savedAcl(external)).toBe(externalBefore);
		expect(await savedAcl(includeDirectory)).toBe(directoryBefore);
	});

	test("rejects an included .conf directory that prevents OpenSSH from reading the config", async ({
		root,
		logger,
	}) => {
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
			SshConfig.createManaged(current, logger, scriptPath).update(
				sshValues("coder-directory", "directory-user"),
			),
		).rejects.toThrow("Move or rename it");
		expect(await savedAcl(directory)).toBe(before);
		await fs.rename(directory, path.join(root, "folder"));
		await SshConfig.createManaged(current, logger, scriptPath).update(
			sshValues("coder-directory", "directory-user"),
		);
		expect(await resolve(parent, "coder-directory")).toContain(
			"proxycommand directory-user",
		);
	});

	test("still writes a usable config when the script cannot run", async ({
		root,
		logger,
	}) => {
		const current = path.join(root, "current.conf");
		await SshConfig.createManaged(
			current,
			logger,
			path.join(root, "missing.js"),
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

	test.for([
		[[], "Expected a file path and user SID"],
		[["unused.conf", "S-1-invalid"], "Invalid Windows user SID"],
	] as const)(
		"rejects invalid script arguments %j",
		async ([args, message]) => {
			await expect(
				execFile(windowsExecutable("cscript.exe"), [
					"//nologo",
					"//B",
					"//E:JScript",
					scriptPath,
					...args,
				]),
			).rejects.toMatchObject({
				code: 1,
				stderr: expect.stringContaining(message),
			});
		},
	);
});
