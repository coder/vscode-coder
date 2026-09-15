import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import {
	hasCanonicalExpectedFileAcl,
	isFullyQualifiedWindowsPath,
	parseWhoamiUserSid,
	readSavedAclDescriptor,
} from "./windowsAclFormat";

const execute = promisify(execFile);

/** Repairs managed file DACLs without changing directory permissions or owners. */
export class WindowsAcl {
	constructor(private readonly scriptPath: string) {}

	async secure(target: string): Promise<void> {
		try {
			await this.validateFile(target);
			target = path.win32.normalize(target);
			const sid = await this.currentUserSid();
			// https://learn.microsoft.com/windows-server/administration/windows-commands/icacls
			await this.run("icacls.exe", [target, "/inheritancelevel:d"]);
			// https://learn.microsoft.com/windows-server/administration/windows-commands/cscript
			await this.run("cscript.exe", [
				"//nologo",
				"//B",
				"//E:JScript",
				this.scriptPath,
				target,
				sid,
			]);
			await this.verifyFileAcl(target, sid);
		} catch (error) {
			throw new Error(
				`Could not repair SSH config permissions for ${target}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}
	}

	private async validateFile(target: string): Promise<void> {
		if (!isFullyQualifiedWindowsPath(target)) {
			throw new Error(
				"Expected a fully qualified Windows file path without wildcards or control characters",
			);
		}
		const stat = await fs.lstat(target);
		if (!stat.isFile() || stat.nlink !== 1) {
			throw new Error("Expected a regular file with no links");
		}
	}

	private async currentUserSid(): Promise<string> {
		// https://learn.microsoft.com/windows-server/administration/windows-commands/whoami
		const { stdout } = await this.run("whoami.exe", [
			"/user",
			"/fo",
			"csv",
			"/nh",
		]);
		const sid = parseWhoamiUserSid(stdout);
		if (!sid) {
			throw new Error("Could not read the current Windows user SID");
		}
		return sid;
	}

	private async readFileAcl(target: string): Promise<string> {
		const directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "coder-ssh-acl-"),
		);
		try {
			const backup = path.join(directory, "acl.txt");
			await this.run("icacls.exe", [target, "/save", backup]);
			return readSavedAclDescriptor(
				target,
				await fs.readFile(backup, "utf16le"),
			);
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	}

	private async verifyFileAcl(target: string, sid: string): Promise<void> {
		if (!hasCanonicalExpectedFileAcl(await this.readFileAcl(target), sid)) {
			throw new Error(
				"Windows ACL does not contain only the expected protected permissions",
			);
		}
	}

	private run(name: string, args: string[]) {
		const systemRoot = process.env.SystemRoot;
		if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
			throw new Error("SystemRoot must be an absolute Windows path");
		}
		return execute(path.join(systemRoot, "System32", name), args, {
			windowsHide: true,
			timeout: 10_000,
			maxBuffer: 64 * 1024,
			encoding: "utf8",
		});
	}
}
