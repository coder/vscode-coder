import { type Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { type Logger } from "../logging/logger";

export interface CollectedFile {
	data: Uint8Array;
	mtimeMs: number;
	relativePath: string;
}

// 3 days is enough context for recent issues; matching the 7-day
// rotation would bloat the bundle.
const LOG_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_LOG_SCAN_DEPTH = 6;

export const isLogFile = (name: string): boolean => name.endsWith(".log");

export function normalizeZipPath(filePath: string): string {
	return filePath.replaceAll(path.sep, "/");
}

export function addFiles(
	target: Map<string, Uint8Array>,
	source: Map<string, Uint8Array>,
): void {
	for (const [name, data] of source) {
		target.set(name, data);
	}
}

export function prefixFiles(
	prefix: string,
	files: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
	return new Map([...files].map(([name, data]) => [`${prefix}/${name}`, data]));
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
	return isObject(error) && error["code"] === "ENOENT";
}

function cutoffTime(): number {
	return Date.now() - LOG_MAX_AGE_MS;
}

async function readRecentFile(
	filePath: string,
	logger: Logger,
): Promise<{ data: Uint8Array; mtimeMs: number } | undefined> {
	try {
		const stat = await fs.stat(filePath);
		if (!stat.isFile() || stat.mtimeMs < cutoffTime()) {
			return undefined;
		}
		return { data: await fs.readFile(filePath), mtimeMs: stat.mtimeMs };
	} catch (error) {
		logger.warn(`Could not read log file ${filePath}`, error);
		return undefined;
	}
}

async function readDir(
	dirPath: string,
	logger: Logger,
	options: { withFileTypes: true; warnOnMissing?: boolean },
): Promise<Dirent[]>;
async function readDir(
	dirPath: string,
	logger: Logger,
	options?: { warnOnMissing?: boolean },
): Promise<string[]>;
async function readDir(
	dirPath: string,
	logger: Logger,
	options: { withFileTypes?: boolean; warnOnMissing?: boolean } = {},
): Promise<Dirent[] | string[]> {
	try {
		return options.withFileTypes
			? await fs.readdir(dirPath, { withFileTypes: true })
			: await fs.readdir(dirPath);
	} catch (error) {
		if (options.warnOnMissing !== false || !isNotFoundError(error)) {
			logger.warn(`Could not read log directory ${dirPath}`, error);
		}
		return [];
	}
}

export async function collectDirFiles(
	dirPath: string,
	logger: Logger,
	filter: (name: string) => boolean = () => true,
	warnOnMissing = true,
): Promise<Map<string, Uint8Array>> {
	const results = new Map<string, Uint8Array>();
	const entries = await readDir(dirPath, logger, { warnOnMissing });

	await Promise.all(
		entries.map(async (entry) => {
			if (!filter(entry)) {
				return;
			}

			const file = await readRecentFile(path.join(dirPath, entry), logger);
			if (file) {
				results.set(entry, file.data);
			}
		}),
	);

	return results;
}

export async function collectMatchingFiles(
	rootPath: string,
	logger: Logger,
	matches: (relativePath: string, fileName: string) => boolean,
): Promise<CollectedFile[]> {
	const results: CollectedFile[] = [];

	async function walk(dirPath: string, depth: number): Promise<void> {
		const entries = await readDir(dirPath, logger, { withFileTypes: true });
		await Promise.all(
			entries.map(async (entry) => {
				const entryPath = path.join(dirPath, entry.name);

				if (entry.isDirectory()) {
					if (depth < MAX_LOG_SCAN_DEPTH) {
						await walk(entryPath, depth + 1);
					}
					return;
				}

				const relativePath = path.relative(rootPath, entryPath);
				if (!entry.isFile() || !matches(relativePath, entry.name)) {
					return;
				}

				const file = await readRecentFile(entryPath, logger);
				if (file) {
					results.push({ ...file, relativePath });
				}
			}),
		);
	}

	await walk(rootPath, 0);
	return results;
}
