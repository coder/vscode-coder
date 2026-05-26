import * as fs from "node:fs/promises";

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
 * Example: tempFilePath("/a/b", "temp") → "/a/b.temp-k7x3f9qw"
 */
export function tempFilePath(basePath: string, suffix: string): string {
	return `${basePath}.${suffix}-${crypto.randomUUID().substring(0, 8)}`;
}

/**
 * Atomically writes to `outputPath` via a sibling temp file and rename.
 * The parent directory must already exist. On failure the destination is
 * left untouched, the temp file is best-effort removed, and the writer
 * error is always rethrown. `onCleanupError` receives any error from the
 * cleanup attempt; its own throws are swallowed.
 */
export async function writeAtomically<T>(
	outputPath: string,
	write: (tempPath: string) => Promise<T>,
	onCleanupError: (err: unknown, tempPath: string) => void,
): Promise<T> {
	const tempPath = tempFilePath(outputPath, "temp");
	try {
		const result = await write(tempPath);
		await renameWithRetry(fs.rename, tempPath, outputPath);
		return result;
	} catch (err) {
		try {
			await fs.rm(tempPath, { force: true }).catch((rmErr) => {
				onCleanupError(rmErr, tempPath);
			});
		} catch {
			// onCleanupError threw; the writer error below takes precedence.
		}
		throw err;
	}
}
