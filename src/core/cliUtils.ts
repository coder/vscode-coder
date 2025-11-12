import { execFile, type ExecFileException } from "node:child_process";
import * as crypto from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Minimum age in milliseconds before cleaning up temporary files.
 * This prevents deleting files that are actively being created by another window.
 */
const MIN_TEMP_FILE_AGE_MS = 30 * 60 * 1000;

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

// util.promisify types are dynamic so there is no concrete type we can import
// and we have to make our own.
type ExecException = ExecFileException & { stdout?: string; stderr?: string };

/**
 * Return the version from the binary.  Throw if unable to execute the binary or
 * find the version for any reason.
 */
export async function version(binPath: string): Promise<string> {
	let stdout: string;
	try {
		const result = await promisify(execFile)(binPath, [
			"version",
			"--output",
			"json",
		]);
		stdout = result.stdout;
	} catch (error) {
		// It could be an old version without support for --output.
		if ((error as ExecException)?.stderr?.includes("unknown flag: --output")) {
			const result = await promisify(execFile)(binPath, ["version"]);
			if (result.stdout?.startsWith("Coder")) {
				const v = result.stdout.split(" ")[1]?.trim();
				if (!v) {
					throw new Error("No version found in output: ${result.stdout}");
				}
				return v;
			}
		}
		throw error;
	}

	const json = JSON.parse(stdout);
	if (!json.version) {
		throw new Error("No version found in output: ${stdout}");
	}
	return json.version;
}

export type RemovalResult = {
	fileName: string;
	error: unknown;
	skipped?: boolean;
};

/**
 * Remove binaries in the same directory as the specified path that have a
 * .old-* or .temp-* extension along with signatures (files ending in .asc).
 * Return a list of files and the errors trying to remove them, when applicable.
 */
export async function rmOld(binPath: string): Promise<RemovalResult[]> {
	const binDir = path.dirname(binPath);
	try {
		const files = await fs.readdir(binDir);
		const results: RemovalResult[] = [];
		const now = Date.now();
		for (const file of files) {
			const fileName = path.basename(file);
			if (
				fileName.includes(".old-") ||
				fileName.includes(".temp-") ||
				fileName.endsWith(".asc")
			) {
				try {
					const filePath = path.join(binDir, file);
					const stats = await fs.stat(filePath);
					const fileAge = now - stats.mtimeMs;

					// Do not delete recently created files, they could be downloads in-progress
					if (fileAge < MIN_TEMP_FILE_AGE_MS) {
						results.push({ fileName, error: undefined, skipped: true });
						continue;
					}

					await fs.rm(filePath, { force: true });
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
 * Return the binary name for the current platform.
 */
export function name(): string {
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
