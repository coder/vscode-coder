import { unzip, zip, type Zippable } from "fflate";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { type Logger } from "../logging/logger";
import { renameWithRetry } from "../util/fs";

import { collectVsCodeDiagnostics, type LogSources } from "./logFiles";

export type { LogSources } from "./logFiles";

const unzipAsync = promisify(unzip);
const zipAsync = promisify(zip);

/**
 * Best-effort: append VS Code logs to the bundle zip, swapped in by atomic
 * rename so a failure leaves the original intact.
 */
export async function appendVsCodeLogs(
	zipPath: string,
	sources: LogSources,
	logger: Logger,
): Promise<void> {
	try {
		const diagnosticFiles = await collectVsCodeDiagnostics(sources, logger);
		if (diagnosticFiles.size === 0) {
			logger.info("No VS Code diagnostics found to add to support bundle");
			return;
		}

		logger.info(
			`Adding ${diagnosticFiles.size} VS Code diagnostic file(s) to support bundle`,
		);

		const outputBundlePath = vscodeBundlePath(zipPath);
		try {
			await writeBundleWithDiagnostics(
				zipPath,
				outputBundlePath,
				diagnosticFiles,
			);
		} catch (error) {
			logger.error(
				"Failed to add VS Code diagnostics to support bundle",
				error,
			);

			// Write-failure path only: success and failed-rename both keep the file.
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
				`Could not replace original bundle; VS Code diagnostics saved separately at ${outputBundlePath}`,
				error,
			);
		}
	} catch (error) {
		// Best-effort: never let a failure here lose the user's bundle.
		logger.error("Unexpected error appending VS Code diagnostics", error);
	}
}

function vscodeBundlePath(zipPath: string): string {
	const parsed = path.parse(zipPath);
	return path.join(
		parsed.dir,
		`${parsed.name}-vscode-${randomUUID().slice(0, 8)}${parsed.ext}`,
	);
}

async function writeBundleWithDiagnostics(
	zipPath: string,
	outputPath: string,
	diagnosticFiles: Map<string, Uint8Array>,
): Promise<void> {
	const sourceMode = (await fs.stat(zipPath)).mode & 0o777;
	const entries: Zippable = await unzipAsync(await fs.readFile(zipPath));

	for (const [name, data] of diagnosticFiles) {
		entries[name] = data;
	}

	// Set mode at create time: avoids a umask window and a fallible chmod.
	await fs.writeFile(outputPath, await zipAsync(entries), { mode: sourceMode });
}
