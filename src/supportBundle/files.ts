import { type Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { type Logger } from "../logging/logger";

export interface CollectedFile {
	data: Uint8Array;
	mtimeMs: number;
	relativePath: string;
}

/** 3-day window; the 7-day rotation would bloat the bundle. */
const LOG_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_LOG_SCAN_DEPTH = 6;
/** Per-file cap to prevent OOM on multi-GB debug logs. */
const MAX_LOG_FILE_BYTES = 50 * 1024 * 1024;

// .log and VS Code's rotated .log.N.
export const isLogFile = (name: string): boolean => /\.log(\.\d+)?$/.test(name);

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

/** lstat-guarded read; tail-truncates files over `MAX_LOG_FILE_BYTES`. */
export async function readLogFile(
	filePath: string,
	logger: Logger,
): Promise<{ data: Uint8Array; mtimeMs: number } | undefined> {
	try {
		const stat = await fs.lstat(filePath);
		if (!stat.isFile()) {
			return undefined;
		}
		if (stat.size > MAX_LOG_FILE_BYTES) {
			logger.warn(
				`Truncating log file ${filePath} (${stat.size} bytes) to last ${MAX_LOG_FILE_BYTES} bytes`,
			);
			return {
				data: await readTail(filePath, MAX_LOG_FILE_BYTES),
				mtimeMs: stat.mtimeMs,
			};
		}
		return { data: await fs.readFile(filePath), mtimeMs: stat.mtimeMs };
	} catch (error) {
		logger.warn(`Could not read log file ${filePath}`, error);
		return undefined;
	}
}

export async function readDirents(
	dirPath: string,
	logger: Logger,
	warnOnMissing = true,
): Promise<Dirent[]> {
	try {
		return await fs.readdir(dirPath, { withFileTypes: true });
	} catch (error) {
		if (warnOnMissing || !isEnoent(error)) {
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
	const entries = await readDirents(dirPath, logger, warnOnMissing);

	await Promise.all(
		entries.map(async (entry) => {
			if (!entry.isFile() || !filter(entry.name)) {
				return;
			}
			const file = await readRecentFile(path.join(dirPath, entry.name), logger);
			if (file) {
				results.set(entry.name, file.data);
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
		// Ignore ENOENT on descent: log rotation races are normal.
		const entries = await readDirents(dirPath, logger, depth === 0);
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

function isEnoent(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

/** Read the last `length` bytes of `filePath`. */
async function readTail(filePath: string, length: number): Promise<Uint8Array> {
	const handle = await fs.open(filePath, "r");
	try {
		const { size } = await handle.stat();
		const offset = Math.max(0, size - length);
		const readLen = Math.min(length, size);
		const buf = Buffer.alloc(readLen);
		const { bytesRead } = await handle.read(buf, 0, readLen, offset);
		return buf.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

async function readRecentFile(
	filePath: string,
	logger: Logger,
): Promise<{ data: Uint8Array; mtimeMs: number } | undefined> {
	const file = await readLogFile(filePath, logger);
	if (!file || file.mtimeMs < Date.now() - LOG_MAX_AGE_MS) {
		return undefined;
	}
	return file;
}
