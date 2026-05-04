import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Logger } from "../logging/logger";

export interface FileCleanupCandidate {
	name: string;
	mtime: number;
	size: number;
}

export interface FileCleanupOptions {
	/** Human-readable noun used in log messages, e.g. "telemetry file". */
	fileType: string;
	/**
	 * Optional name-based filter applied before stat. Use this to skip
	 * unrelated entries cheaply. Files for which `match` returns false are
	 * never stat'd or passed to `pick`.
	 */
	match?: (name: string) => boolean;
	/**
	 * Picks files to delete after stat. Receives `{ name, mtime, size }` for
	 * each survivor of `match`, plus the current time.
	 */
	pick: (files: FileCleanupCandidate[], now: number) => Array<{ name: string }>;
}

/**
 * Stats files in `dir` in parallel (after the optional name-based `match`),
 * lets `pick` choose which to delete, then unlinks them in parallel.
 * Tolerates concurrent deletes from other processes (ENOENT is swallowed).
 * Never throws; failures are logged via `logger.debug`.
 */
export async function cleanupFiles(
	dir: string,
	logger: Logger,
	options: FileCleanupOptions,
): Promise<void> {
	const { fileType, match, pick } = options;
	try {
		const now = Date.now();
		const names = await fs.readdir(dir);
		const candidates = match ? names.filter(match) : names;

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
						logger.debug(`Failed to stat ${fileType} ${name}`, error);
					}
					return null;
				}
			}),
		);

		const toDelete = pick(
			withStats.filter((f) => f !== null),
			now,
		);

		const deleted = await Promise.all(
			toDelete.map(async (file) => {
				try {
					await fs.unlink(path.join(dir, file.name));
					return file.name;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
						logger.debug(`Failed to delete ${fileType} ${file.name}`, error);
					}
					return null;
				}
			}),
		);

		const successful = deleted.filter((name) => name !== null);
		if (successful.length > 0) {
			logger.debug(
				`Cleaned up ${successful.length} ${fileType}(s): ${successful.join(", ")}`,
			);
		}
	} catch {
		// Directory may not exist yet, ignore.
	}
}
