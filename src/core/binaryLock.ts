import prettyBytes from "pretty-bytes";
import * as lockfile from "proper-lockfile";
import * as vscode from "vscode";

import { type Logger } from "../logging/logger";

import * as downloadProgress from "./downloadProgress";

/**
 * Timeout to detect stale lock files and take over from stuck processes.
 * This value is intentionally small so we can quickly takeover.
 */
const STALE_TIMEOUT_MS = 15000;

const LOCK_POLL_INTERVAL_MS = 500;

type LockRelease = () => Promise<void>;

/**
 * Manages file locking for binary downloads to coordinate between multiple
 * VS Code windows downloading the same binary.
 */
export class BinaryLock {
	constructor(
		private readonly vscodeProposed: typeof vscode,
		private readonly output: Logger,
	) {}

	/**
	 * Acquire the lock, or wait for another process if the lock is held.
	 * Returns the lock release function and a flag indicating if we waited.
	 */
	async acquireLockOrWait(
		binPath: string,
		progressLogPath: string,
	): Promise<{ release: LockRelease; waited: boolean }> {
		const release = await this.safeAcquireLock(binPath);
		if (release) {
			return { release, waited: false };
		}

		this.output.info(
			"Another process is downloading the binary, monitoring progress",
		);
		const newRelease = await this.monitorDownloadProgress(
			binPath,
			progressLogPath,
		);
		return { release: newRelease, waited: true };
	}

	/**
	 * Attempt to acquire a lock on the binary file.
	 * Returns the release function if successful, null if lock is already held.
	 */
	private async safeAcquireLock(path: string): Promise<LockRelease | null> {
		try {
			const release = await lockfile.lock(path, {
				stale: STALE_TIMEOUT_MS,
				retries: 0,
				realpath: false,
			});
			return release;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ELOCKED") {
				throw error;
			}
			return null;
		}
	}

	/**
	 * Monitor download progress from another process by polling the progress log
	 * and attempting to acquire the lock. Shows a VS Code progress notification.
	 * Returns the lock release function once the download completes.
	 */
	private async monitorDownloadProgress(
		binPath: string,
		progressLogPath: string,
	): Promise<LockRelease> {
		return await this.vscodeProposed.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Another window is downloading the Coder CLI binary",
				cancellable: false,
			},
			async (progress) => {
				return new Promise<LockRelease>((resolve, reject) => {
					const poll = async () => {
						try {
							await this.updateProgressMonitor(progressLogPath, progress);
							const release = await this.safeAcquireLock(binPath);
							if (release) {
								return resolve(release);
							}
							// Schedule next poll only after current one completes
							setTimeout(poll, LOCK_POLL_INTERVAL_MS);
						} catch (error) {
							reject(error);
						}
					};
					poll().catch((error) => reject(error));
				});
			},
		);
	}

	private async updateProgressMonitor(
		progressLogPath: string,
		progress: vscode.Progress<{ message?: string }>,
	): Promise<void> {
		const currentProgress =
			await downloadProgress.readProgress(progressLogPath);
		if (currentProgress) {
			const totalBytesPretty =
				currentProgress.totalBytes === null
					? "unknown"
					: prettyBytes(currentProgress.totalBytes);
			const message =
				currentProgress.status === "verifying"
					? "Verifying signature..."
					: `${prettyBytes(currentProgress.bytesDownloaded)} / ${totalBytesPretty}`;
			progress.report({ message });
		}
	}
}
