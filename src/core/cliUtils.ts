import * as crypto from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Custom error thrown when a binary file is locked (typically on Windows).
 */
export class FileLockError extends Error {
	constructor(binPath: string) {
		super(`Binary is in use: ${binPath}`);
		this.name = "WindowsFileLockError";
	}
}

/**
 * Stat the path or undefined if the path does not exist.  Throw if unable to
 * stat for a reason other than the path not existing.
 */
export async function stat(binPath: string): Promise<Stats | undefined> {
	try {
		return await fs.stat(binPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

export interface RemovalResult {
	fileName: string;
	error: unknown;
}

/**
 * Remove binaries in the same directory as the specified path that have a
 * .old-* or .temp-* extension along with signatures (files ending in .asc).
 * Return a list of files and the errors trying to remove them, when applicable.
 */
export async function rmOld(binPath: string): Promise<RemovalResult[]> {
	const binDir = path.dirname(binPath);
	const binBase = path.basename(binPath);
	try {
		const files = await fs.readdir(binDir);
		const results: RemovalResult[] = [];
		for (const file of files) {
			const fileName = path.basename(file);
			if (
				fileName.startsWith(binBase) &&
				(fileName.includes(".old-") ||
					fileName.includes(".temp-") ||
					fileName.endsWith(".asc") ||
					fileName.endsWith(".progress.log"))
			) {
				try {
					await fs.rm(path.join(binDir, file), { force: true });
					results.push({ fileName, error: undefined });
				} catch (error) {
					results.push({ fileName, error });
				}
			}
		}
		return results;
	} catch (error) {
		// If the directory does not exist, there is nothing to remove.
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

/**
 * Find all .old-* binaries in the same directory as the given binary path.
 * Returns paths sorted by modification time (most recent first).
 */
export async function findOldBinaries(binPath: string): Promise<string[]> {
	const binDir = path.dirname(binPath);
	const binName = path.basename(binPath);
	try {
		const files = await fs.readdir(binDir);
		const oldBinaries = files
			.filter((f) => f.startsWith(binName) && f.includes(".old-"))
			.map((f) => path.join(binDir, f));

		// Sort by modification time, most recent first
		const stats = await Promise.allSettled(
			oldBinaries.map(async (f) => ({
				path: f,
				mtime: (await fs.stat(f)).mtime,
			})),
		).then((result) =>
			result
				.filter((promise) => promise.status === "fulfilled")
				.map((promise) => promise.value),
		);
		stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
		return stats.map((s) => s.path);
	} catch (error) {
		// If directory doesn't exist, return empty array
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

export function maybeWrapFileLockError(
	error: unknown,
	binPath: string,
): unknown {
	const code = (error as NodeJS.ErrnoException).code;
	if (code === "EBUSY" || code === "EPERM") {
		return new FileLockError(binPath);
	}
	return error;
}

/**
 * Return the etag (sha1) of the path.  Throw if unable to hash the file.
 */
export async function eTag(binPath: string): Promise<string> {
	const hash = crypto.createHash("sha1");
	const stream = createReadStream(binPath);
	return new Promise((resolve, reject) => {
		stream.on("end", () => {
			hash.end();
			resolve(hash.digest("hex"));
		});
		stream.on("error", (err) => {
			reject(err);
		});
		stream.on("data", (chunk) => {
			hash.update(chunk);
		});
	});
}

/**
 * Return the platform-specific binary name (e.g. "coder-linux-amd64").
 */
export function fullName(): string {
	const os = goos();
	const arch = goarch();
	let binName = `coder-${os}-${arch}`;
	// Windows binaries have an exe suffix.
	if (os === "windows") {
		binName += ".exe";
	}
	return binName;
}

/**
 * Return the simple binary name ("coder" or "coder.exe" on Windows).
 * This is the name used by package managers, as opposed to the
 * platform-specific name returned by fullName().
 */
export function simpleName(): string {
	return goos() === "windows" ? "coder.exe" : "coder";
}

/**
 * Returns the Go format for the current platform.
 * Coder binaries are created in Go, so we conform to that name structure.
 */
export function goos(): string {
	const platform = os.platform();
	switch (platform) {
		case "win32":
			return "windows";
		default:
			return platform;
	}
}

/**
 * Return the Go format for the current architecture.
 */
export function goarch(): string {
	const arch = os.arch();
	switch (arch) {
		case "arm":
			return "armv7";
		case "x64":
			return "amd64";
		default:
			return arch;
	}
}
