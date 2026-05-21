import { type Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { type Logger } from "../logging/logger";

interface WindowLogDir {
	relativePath: string;
	windowPath: string;
}

export interface LogContext {
	currentWindowPath: string;
	logsRoot: string;
}

export function resolveLogContext(
	extensionLogDir: string,
): LogContext | undefined {
	const resolved = path.resolve(extensionLogDir);
	const extensionId = path.basename(resolved);
	const exthostDir = path.dirname(resolved);
	const windowDir = path.dirname(exthostDir);
	const windowName = path.basename(windowDir);
	const sessionDir = path.dirname(windowDir);

	if (
		extensionId !== "coder.coder-remote" ||
		path.basename(exthostDir) !== "exthost" ||
		!/^window\d+$/i.test(windowName)
	) {
		return undefined;
	}

	const sessionName = path.basename(sessionDir);
	return {
		currentWindowPath: windowDir,
		logsRoot: /^\d{8}T\d{6}/.test(sessionName)
			? path.dirname(sessionDir)
			: sessionDir,
	};
}

async function readDirents(dirPath: string, logger: Logger): Promise<Dirent[]> {
	try {
		return await fs.readdir(dirPath, { withFileTypes: true });
	} catch (error) {
		logger.warn(`Could not read log directory ${dirPath}`, error);
		return [];
	}
}

export async function collectWindowLogDirs(
	logsRoot: string,
	logger: Logger,
): Promise<WindowLogDir[]> {
	const windows: WindowLogDir[] = [];
	const rootEntries = await readDirents(logsRoot, logger);

	await Promise.all(
		rootEntries.map(async (entry) => {
			if (!entry.isDirectory()) {
				return;
			}

			const entryPath = path.join(logsRoot, entry.name);
			if (/^window\d+$/i.test(entry.name)) {
				windows.push({ relativePath: entry.name, windowPath: entryPath });
				return;
			}

			const sessionEntries = await readDirents(entryPath, logger);
			for (const windowEntry of sessionEntries.filter(
				(sessionEntry) =>
					sessionEntry.isDirectory() && /^window\d+$/i.test(sessionEntry.name),
			)) {
				windows.push({
					relativePath: `${entry.name}/${windowEntry.name}`,
					windowPath: path.join(entryPath, windowEntry.name),
				});
			}
		}),
	);

	return windows.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
