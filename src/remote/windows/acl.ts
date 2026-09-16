import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { wrapError } from "../../error/errorUtils";

import {
	hasCanonicalExpectedFileAcl,
	isFullyQualifiedWindowsPath,
	parseWhoamiUserSid,
	readSavedAclDescriptor,
} from "./aclFormat";

import type { FilePermissions } from "../sshConfig";

const EXECUTE = promisify(execFile);

const ACL_SCRIPT = "assets/wsh/acl.js";

/** Only Windows needs DACL repair; elsewhere the file mode suffices. */
export function createFilePermissions(
	extensionPath: string,
): FilePermissions | undefined {
	return process.platform === "win32"
		? new WindowsAcl(extensionPath)
		: undefined;
}

/** Repairs managed file DACLs without changing directory permissions or owners. */
export class WindowsAcl implements FilePermissions {
	private readonly scriptPath: string;
	private sidPromise: Promise<string> | undefined;

	constructor(extensionPath: string) {
		this.scriptPath = path.join(extensionPath, ACL_SCRIPT);
	}

	/**
	 * A process token's user SID is fixed at startup and the extension never
	 * impersonates, so one lookup serves every file. A failure is not cached,
	 * leaving the next file free to retry.
	 */
	private get sid(): Promise<string> {
		this.sidPromise ??= this.readSid().catch((error: unknown) => {
			this.sidPromise = undefined;
			throw error;
		});
		return this.sidPromise;
	}

	/** Replace and verify a single file DACL; leave contents and ownership alone. */
	async secure(target: string): Promise<void> {
		const file = path.win32.normalize(target);
		try {
			await this.validateFile(target);
			const sid = await this.sid;
			// Repair costs several processes, so skip files already correct.
			if (hasCanonicalExpectedFileAcl(await this.readFileAcl(file), sid)) {
				return;
			}
			// Clears the inherit-from-parent control bit ADSI cannot reach.
			// https://learn.microsoft.com/windows-server/administration/windows-commands/icacls
			await this.run("icacls.exe", [file, "/inheritancelevel:d"]);
			// No banner, prompts, or interactive dialogs.
			// https://learn.microsoft.com/windows-server/administration/windows-commands/cscript
			await this.run("cscript.exe", [
				"//nologo",
				"//B",
				"//E:JScript",
				this.scriptPath,
				file,
				sid,
			]);
			if (!hasCanonicalExpectedFileAcl(await this.readFileAcl(file), sid)) {
				throw new Error(
					"Windows ACL does not contain only the expected protected permissions",
				);
			}
		} catch (error) {
			throw wrapError("repair SSH config permissions for", file, error);
		}
	}

	/** Refuse non-files and linked files before any permissions are changed. */
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

	/** Read the SID, not the localized account name, from CSV without a heading. */
	private async readSid(): Promise<string> {
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

	/** Read a UTF-16 icacls backup and remove it even when verification fails. */
	private async readFileAcl(target: string): Promise<string> {
		const backup = path.join(os.tmpdir(), `coder-ssh-acl-${randomUUID()}.txt`);
		try {
			await this.run("icacls.exe", [target, "/save", backup]);
			return readSavedAclDescriptor(
				target,
				await fs.readFile(backup, "utf16le"),
			);
		} finally {
			await fs.rm(backup, { force: true });
		}
	}

	private run(name: string, args: string[]) {
		return EXECUTE(system32(name), args, {
			windowsHide: true,
			timeout: 10_000,
			maxBuffer: 64 * 1024,
			encoding: "utf8",
		});
	}
}

/** Resolve a system tool without searching PATH or the working directory. */
export function system32(name: string): string {
	// From the inherited launch environment, not extension configuration.
	const systemRoot = process.env.SystemRoot;
	if (!systemRoot || !isFullyQualifiedWindowsPath(systemRoot)) {
		throw new Error("SystemRoot must be a fully qualified Windows path");
	}
	return path.join(systemRoot, "System32", name);
}
