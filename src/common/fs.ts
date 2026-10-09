import * as fs from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";

import type { Logger } from "../logging/logger";

const transientRenameCodes: ReadonlySet<string> = new Set([
	"EPERM",
	"EACCES",
	"EBUSY",
]);

/**
 * Rename with retry for transient Windows filesystem errors (EPERM, EACCES,
 * EBUSY). On Windows, antivirus, Search Indexer, cloud sync, or concurrent
 * processes can briefly lock files causing renames to fail.
 *
 * On non-Windows platforms, calls renameFn directly with no retry.
 *
 * Matches the strategy used by VS Code (pfs.ts) and graceful-fs: 60s
 * wall-clock timeout with linear backoff (10ms increments) capped at 100ms.
 */
export async function renameWithRetry(
	renameFn: (src: string, dest: string) => Promise<void>,
	source: string,
	destination: string,
	timeoutMs = 60_000,
	delayCapMs = 100,
): Promise<void> {
	if (process.platform !== "win32") {
		return renameFn(source, destination);
	}
	const startTime = Date.now();
	for (let attempt = 1; ; attempt++) {
		try {
			return await renameFn(source, destination);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (
				!code ||
				!transientRenameCodes.has(code) ||
				Date.now() - startTime >= timeoutMs
			) {
				throw err;
			}
			const delay = Math.min(delayCapMs, attempt * 10);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
}

/**
 * Generate a temporary file path by appending a suffix with a random component.
 * The suffix describes the purpose of the temp file (e.g. "temp", "old").
 * Example: tempFilePath("/a/b", "temp") returns "/a/b.temp-b91b24be"
 */
export function tempFilePath(basePath: string, suffix: string): string {
	return `${basePath}.${suffix}-${crypto.randomUUID().substring(0, 8)}`;
}

/**
 * Atomically writes to `outputPath` via a sibling temp file and rename.
 * The parent directory must already exist. On failure the destination is
 * left untouched, the temp file is best-effort removed, and the writer
 * error is always rethrown. `onCleanupError`, if given, receives any error
 * from the cleanup attempt; its own throws are swallowed.
 */
export async function writeAtomically<T>(
	outputPath: string,
	write: (tempPath: string) => Promise<T>,
	onCleanupError?: (err: unknown, tempPath: string) => void,
): Promise<T> {
	const tempPath = tempFilePath(outputPath, "temp");
	try {
		const result = await write(tempPath);
		await renameWithRetry(fs.rename, tempPath, outputPath);
		return result;
	} catch (err) {
		try {
			await fs.rm(tempPath, { force: true }).catch((rmErr) => {
				onCleanupError?.(rmErr, tempPath);
			});
		} catch {
			// onCleanupError threw; the writer error below takes precedence.
		}
		throw err;
	}
}

export interface FileCleanupCandidate {
	name: string;
	mtime: number;
	size: number;
}

export interface FileCleanupOptions {
	/** Label for log messages, e.g. "telemetry file". */
	label: string;
	/** Cheap name-based predicate; non-matching entries are skipped before stat. */
	filter?: (name: string) => boolean;
	/** From the stat'd survivors of `filter`, returns the files to delete. */
	select: (
		files: FileCleanupCandidate[],
		now: number,
	) => Array<{ name: string }>;
}

/**
 * Lists files in `dir`, applies `filter` to names, stats the survivors, and
 * unlinks whatever `select` returns. ENOENT is swallowed so concurrent
 * deletes are safe. Never throws; failures go to `logger.debug`.
 */
export async function cleanupFiles(
	dir: string,
	logger: Logger,
	options: FileCleanupOptions,
): Promise<void> {
	const { label, filter, select } = options;
	const now = Date.now();
	let names: string[];
	try {
		names = await fs.readdir(dir);
	} catch (error) {
		// ENOENT just means the dir hasn't been created yet; anything else
		// (EACCES, EMFILE, ...) is a real failure worth surfacing.
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			logger.debug(`Failed to read ${label} directory ${dir}`, error);
		}
		return;
	}
	const candidates = filter ? names.filter(filter) : names;

	const withStats = await Promise.all(
		candidates.map(async (name) => {
			try {
				const stats = await fs.stat(path.join(dir, name));
				return {
					name,
					mtime: stats.mtime.getTime(),
					size: stats.size,
				};
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					logger.debug(`Failed to stat ${label} ${name}`, error);
				}
				return null;
			}
		}),
	);

	const toDelete = select(
		withStats.filter((f) => f !== null),
		now,
	);

	const deleted = await Promise.all(
		toDelete.map(async (file) => {
			// Basename only; never let `select` escape `dir`.
			const safeName = path.basename(file.name);
			try {
				await fs.unlink(path.join(dir, safeName));
				return safeName;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					logger.debug(`Failed to delete ${label} ${safeName}`, error);
				}
				return null;
			}
		}),
	);

	const successful = deleted.filter((name) => name !== null);
	if (successful.length > 0) {
		logger.debug(
			`Cleaned up ${successful.length} ${label}(s): ${successful.join(", ")}`,
		);
	}
}

/**
 * Substitute `${env:VAR}` with `process.env.VAR` (unset → empty string),
 * `${userHome}` (anywhere) with `os.homedir()`, and a leading `~` with
 * `os.homedir()`. Env substitution runs first so env values can themselves
 * contain `~` or `${userHome}`.
 */
export function expandPath(input: string): string {
	const expanded = input.replace(
		/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,
		(_, name: string) => process.env[name] ?? "",
	);
	const userHome = os.homedir();
	const tildeExpanded = expanded.startsWith("~")
		? userHome + expanded.substring("~".length)
		: expanded;
	return tildeExpanded.replaceAll("${userHome}", userHome);
}
