import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Logger } from "../logging/logger";

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
