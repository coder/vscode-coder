import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface DownloadProgress {
	bytesDownloaded: number;
	totalBytes: number | null;
	status: "downloading" | "verifying";
}

export async function writeProgress(
	logPath: string,
	progress: DownloadProgress,
): Promise<void> {
	await fs.mkdir(path.dirname(logPath), { recursive: true });
	await fs.writeFile(logPath, JSON.stringify({ ...progress }) + "\n");
}

export async function readProgress(
	logPath: string,
): Promise<DownloadProgress | null> {
	try {
		const content = await fs.readFile(logPath, "utf-8");
		const progress = JSON.parse(content) as DownloadProgress;
		if (
			typeof progress.bytesDownloaded !== "number" ||
			(typeof progress.totalBytes !== "number" &&
				progress.totalBytes !== null) ||
			(progress.status !== "downloading" && progress.status !== "verifying")
		) {
			return null;
		}
		return progress;
	} catch {
		return null;
	}
}

export async function clearProgress(logPath: string): Promise<void> {
	try {
		await fs.rm(logPath, { force: true });
	} catch {
		// If we cannot remove it now then we'll do it in the next startup
	}
}
