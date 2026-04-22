import { unzipSync, zipSync } from "fflate";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { toError } from "../error/errorUtils";
import { type Logger } from "../logging/logger";
import { renameWithRetry } from "../util";

export interface LogSources {
	remoteSshLogPath?: string;
	proxyLogDir?: string;
	extensionLogDir?: string;
}

/** Collect regular files from a directory into zip-ready entries. */
async function collectDirFiles(
	dirPath: string,
	zipPrefix: string,
	logger: Logger,
): Promise<Record<string, Uint8Array>> {
	const files: Record<string, Uint8Array> = {};

	let entries: string[];
	try {
		entries = await fs.readdir(dirPath);
	} catch (error) {
		logger.warn(
			`Could not read log directory ${dirPath}: ${toError(error).message}`,
		);
		return files;
	}

	for (const entry of entries) {
		const filePath = path.join(dirPath, entry);
		try {
			const stat = await fs.stat(filePath);
			if (!stat.isFile()) {
				continue;
			}
			const content = await fs.readFile(filePath);
			files[`${zipPrefix}/${entry}`] = new Uint8Array(content);
		} catch (error) {
			logger.warn(
				`Could not read log file ${filePath}: ${toError(error).message}`,
			);
		}
	}

	return files;
}

/**
 * Gather log files from each source independently so a failure in one
 * does not affect the others.
 */
export async function collectLogFiles(
	sources: LogSources,
	logger: Logger,
): Promise<Record<string, Uint8Array>> {
	const files: Record<string, Uint8Array> = {};

	if (sources.remoteSshLogPath) {
		try {
			const content = await fs.readFile(sources.remoteSshLogPath);
			const name = path.basename(sources.remoteSshLogPath);
			files[`vscode-logs/remote-ssh/${name}`] = new Uint8Array(content);
		} catch (error) {
			logger.warn(`Could not read Remote SSH log: ${toError(error).message}`);
		}
	}

	if (sources.proxyLogDir) {
		Object.assign(
			files,
			await collectDirFiles(sources.proxyLogDir, "vscode-logs/proxy", logger),
		);
	}

	if (sources.extensionLogDir) {
		Object.assign(
			files,
			await collectDirFiles(
				sources.extensionLogDir,
				"vscode-logs/extension",
				logger,
			),
		);
	}

	return files;
}

function vscodeBundlePath(zipPath: string): string {
	const { dir, name, ext } = path.parse(zipPath);
	return path.join(dir, `${name}-vscode${ext}`);
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
	const logFiles = await collectLogFiles(sources, logger);
	const count = Object.keys(logFiles).length;
	if (count === 0) {
		logger.info("No VS Code logs found to add to support bundle");
		return;
	}

	logger.info(`Adding ${count} VS Code log file(s) to support bundle`);

	let updatedData: Uint8Array;
	try {
		const existingData = new Uint8Array(await fs.readFile(zipPath));
		const entries = unzipSync(existingData);
		Object.assign(entries, logFiles);
		updatedData = zipSync(entries);
	} catch (error) {
		logger.error(
			`Failed to add VS Code logs to support bundle: ${toError(error).message}`,
		);
		return;
	}

	// Write to a named temporary path first so a failure mid-write leaves
	// the user with a properly named file containing VS Code logs.
	const tmpPath = vscodeBundlePath(zipPath);
	try {
		await fs.writeFile(tmpPath, updatedData);
	} catch (error) {
		logger.error(
			`Failed to write updated support bundle: ${toError(error).message}`,
		);
		return;
	}

	try {
		await renameWithRetry(fs.rename, tmpPath, zipPath);
	} catch (error) {
		logger.warn(
			`Could not replace original bundle, VS Code logs saved separately: ${toError(error).message}`,
		);
	}
}
