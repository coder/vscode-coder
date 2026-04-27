import { unzip, zip } from "fflate";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { type Logger } from "../logging/logger";
import { renameWithRetry } from "../util";

export interface LogSources {
	remoteSshLogPath?: string;
	proxyLogDir?: string;
	extensionLogDir?: string;
}

// 3 days is enough context for recent issues; matching the 7-day
// rotation would bloat the bundle.
const LOG_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

const unzipAsync = promisify(unzip);
const zipAsync = promisify(zip);

async function collectDirFiles(
	dirPath: string,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	const results = new Map<string, Uint8Array>();

	let entries: string[];
	try {
		entries = await fs.readdir(dirPath);
	} catch (error) {
		logger.warn(`Could not read log directory ${dirPath}`, error);
		return results;
	}

	const cutoff = Date.now() - LOG_MAX_AGE_MS;

	await Promise.all(
		entries.map(async (entry) => {
			const filePath = path.join(dirPath, entry);
			try {
				const stat = await fs.stat(filePath);
				if (!stat.isFile() || stat.mtimeMs < cutoff) {
					return;
				}
				results.set(entry, await fs.readFile(filePath));
			} catch (error) {
				logger.warn(`Could not read log file ${filePath}`, error);
			}
		}),
	);

	return results;
}

/**
 * Gather log files from each source independently so a failure in one
 * does not affect the others.
 */
async function collectLogFiles(
	sources: LogSources,
	logger: Logger,
): Promise<Map<string, Uint8Array>> {
	const files = new Map<string, Uint8Array>();

	if (sources.remoteSshLogPath) {
		try {
			files.set(
				`vscode-logs/remote-ssh/${path.basename(sources.remoteSshLogPath)}`,
				await fs.readFile(sources.remoteSshLogPath),
			);
		} catch (error) {
			logger.warn("Could not read Remote SSH log", error);
		}
	}

	if (sources.proxyLogDir) {
		for (const [name, data] of await collectDirFiles(
			sources.proxyLogDir,
			logger,
		)) {
			files.set(`vscode-logs/proxy/${name}`, data);
		}
	}

	if (sources.extensionLogDir) {
		for (const [name, data] of await collectDirFiles(
			sources.extensionLogDir,
			logger,
		)) {
			files.set(`vscode-logs/extension/${name}`, data);
		}
	}

	return files;
}

/**
 * Best-effort: append VS Code logs to a support bundle zip.
 * Uses atomic rename to avoid corrupting the original bundle on failure.
 */
export async function appendVsCodeLogs(
	zipPath: string,
	sources: LogSources,
	logger: Logger,
): Promise<void> {
	try {
		const logFiles = await collectLogFiles(sources, logger);
		if (logFiles.size === 0) {
			logger.info("No VS Code logs found to add to support bundle");
			return;
		}

		logger.info(
			`Adding ${logFiles.size} VS Code log file(s) to support bundle`,
		);

		// Write to a named temporary path first so a failure at the rename step
		// leaves the user with a properly named file containing VS Code logs.
		const parsed = path.parse(zipPath);
		const vscodeBundlePath = path.join(
			parsed.dir,
			`${parsed.name}-vscode${parsed.ext}`,
		);

		try {
			const entries = await unzipAsync(await fs.readFile(zipPath));
			for (const [name, data] of logFiles) {
				entries[name] = data;
			}
			const updated = await zipAsync(entries);
			await fs.writeFile(vscodeBundlePath, updated);
		} catch (error) {
			logger.error("Failed to add VS Code logs to support bundle", error);
			try {
				await fs.rm(vscodeBundlePath, { force: true });
			} catch (cleanupError) {
				logger.warn(
					`Could not clean up partial bundle at ${vscodeBundlePath}`,
					cleanupError,
				);
			}
			return;
		}

		try {
			await renameWithRetry(fs.rename, vscodeBundlePath, zipPath);
		} catch (error) {
			logger.warn(
				`Could not replace original bundle; VS Code logs saved separately at ${vscodeBundlePath}`,
				error,
			);
		}
	} catch (error) {
		// Best-effort: never let a failure here lose the user's bundle.
		logger.error("Unexpected error appending VS Code logs", error);
	}
}
