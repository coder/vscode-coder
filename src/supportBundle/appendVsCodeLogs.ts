import { unzip, zip, type Zippable } from "fflate";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { type Logger } from "../logging/logger";
import { renameWithRetry } from "../util/fs";

import { collectVsCodeDiagnostics, type LogSources } from "./diagnostics";

export type { LogSources } from "./diagnostics";

const unzipAsync = promisify(unzip);
const zipAsync = promisify(zip);

function vscodeBundlePath(zipPath: string): string {
	const parsed = path.parse(zipPath);
	return path.join(
		parsed.dir,
		`${parsed.name}-vscode-${randomUUID()}${parsed.ext}`,
	);
}

async function writeBundleWithLogs(
	zipPath: string,
	outputPath: string,
	logFiles: Map<string, Uint8Array>,
): Promise<void> {
	const sourceMode = (await fs.stat(zipPath)).mode & 0o777;
	const entries: Zippable = await unzipAsync(await fs.readFile(zipPath));

	for (const [name, data] of logFiles) {
		entries[name] = data;
	}

	await fs.writeFile(outputPath, await zipAsync(entries));
	await fs.chmod(outputPath, sourceMode);
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
		const logFiles = await collectVsCodeDiagnostics(sources, logger);
		if (logFiles.size === 0) {
			logger.info("No VS Code logs found to add to support bundle");
			return;
		}

		logger.info(
			`Adding ${logFiles.size} VS Code log file(s) to support bundle`,
		);

		const outputBundlePath = vscodeBundlePath(zipPath);
		try {
			await writeBundleWithLogs(zipPath, outputBundlePath, logFiles);
		} catch (error) {
			logger.error("Failed to add VS Code logs to support bundle", error);

			try {
				await fs.rm(outputBundlePath, { force: true });
			} catch (cleanupError) {
				logger.warn(
					`Could not clean up partial bundle at ${outputBundlePath}`,
					cleanupError,
				);
			}
			return;
		}

		try {
			await renameWithRetry(fs.rename, outputBundlePath, zipPath);
		} catch (error) {
			logger.warn(
				`Could not replace original bundle; VS Code logs saved separately at ${outputBundlePath}`,
				error,
			);
		}
	} catch (error) {
		// Best-effort: never let a failure here lose the user's bundle.
		logger.error("Unexpected error appending VS Code logs", error);
	}
}
