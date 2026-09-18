import { execFile } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { wrapError } from "../error/errorUtils";

import type { ManagedPermissions } from "./sshConfig";

const EXECUTE = promisify(execFile);

/** Protect the Coder-managed SSH directory and repair its files by inheritance. */
export const WINDOWS_ACL: ManagedPermissions = { prepareDirectory, secure };

/** Use DACL repair on Windows; other platforms rely on the file mode. */
export function createManagedPermissions(): ManagedPermissions | undefined {
	return process.platform === "win32" ? WINDOWS_ACL : undefined;
}

/** Resolve a system tool without searching PATH or the working directory. */
export function system32(name: string): string {
	const systemRoot = process.env.SystemRoot;
	if (!systemRoot || !isFullyQualifiedWindowsPath(systemRoot)) {
		throw new Error("SystemRoot must be a fully qualified Windows path");
	}
	return path.win32.join(systemRoot, "System32", name);
}

/** Grant inheritable full control to the user, SYSTEM, and Administrators only. */
async function prepareDirectory(target: string): Promise<void> {
	const directory = path.win32.normalize(target);
	try {
		checkPath(directory);
		if (!(await lstat(directory)).isDirectory()) {
			throw new Error("Expected a Coder-managed directory without links");
		}
		// Inheritable grants reach children even without /T, so vet them first.
		for (const entry of await readdir(directory)) {
			await checkRegularFile(path.win32.join(directory, entry));
		}
		const sid = await currentUserSid();
		// /grant:r alone leaves other trustees' explicit grants and denies.
		await run("icacls.exe", [directory, "/reset"]);
		await run("icacls.exe", [
			directory,
			"/inheritance:r",
			"/grant:r",
			`*${sid}:(OI)(CI)F`,
			"*S-1-5-18:(OI)(CI)F", // SYSTEM
			"*S-1-5-32-544:(OI)(CI)F", // Administrators
		]);
	} catch (error) {
		throw wrapError(
			"prepare SSH config directory permissions for",
			directory,
			error,
		);
	}
}

/** Drop a file's own permissions so it inherits the directory's. */
async function secure(target: string): Promise<void> {
	const file = path.win32.normalize(target);
	try {
		await checkRegularFile(file);
		await run("icacls.exe", [file, "/reset"]);
	} catch (error) {
		throw wrapError("repair SSH config permissions for", file, error);
	}
}

/** Accept drive-qualified or UNC paths without wildcards or control characters. */
function isFullyQualifiedWindowsPath(target: string): boolean {
	if (/[\0\r\n*?]/.test(target)) {
		return false;
	}
	const normalized = path.win32.normalize(target);
	return (
		/^[A-Za-z]:\\/.test(normalized) ||
		/^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(normalized)
	);
}

/** Reject ambiguous paths and characters that can expand an icacls target. */
function checkPath(target: string): void {
	if (!isFullyQualifiedWindowsPath(target)) {
		throw new Error(
			"Expected a fully qualified Windows path without wildcards or control characters",
		);
	}
}

/** Reject links and non-files, which share their ACL with another target. */
async function checkRegularFile(target: string): Promise<void> {
	checkPath(target);
	const stat = await lstat(target);
	if (!stat.isFile() || stat.nlink !== 1) {
		throw new Error(
			`Expected a regular file with no links: ${target}. Move or rename linked and non-file entries out of the Coder-managed SSH directory, then reconnect.`,
		);
	}
}

/** Read the SID, not the localized account name, from whoami's CSV output. */
async function currentUserSid(): Promise<string> {
	const { stdout } = await run("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
	const sid = /,"(S-\d+(?:-\d+)+)"\s*$/.exec(stdout)?.[1];
	if (!sid) {
		throw new Error("Could not read the current Windows user SID");
	}
	return sid;
}

/** Run a system tool without a shell, bounding its time and output. */
function run(name: string, args: string[]) {
	return EXECUTE(system32(name), args, {
		windowsHide: true,
		timeout: 10_000,
		maxBuffer: 64 * 1024,
		encoding: "utf8",
	});
}
