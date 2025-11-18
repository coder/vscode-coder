import prettyBytes from "pretty-bytes";
import * as lockfile from "proper-lockfile";
import * as vscode from "vscode";

import { type Logger } from "../logging/logger";

import * as downloadProgress from "./downloadProgress";

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
	): Promise<{ release: () => Promise<void>; waited: boolean }> {
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
	private async safeAcquireLock(
		path: string,
	): Promise<(() => Promise<void>) | null> {
		try {
			const release = await lockfile.lock(path, {
				stale: downloadProgress.STALE_TIMEOUT_MS,
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
	): Promise<() => Promise<void>> {
		return await this.vscodeProposed.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Another window is downloading the Coder CLI binary",
				cancellable: false,
			},
			async (progress) => {
				return new Promise<() => Promise<void>>((resolve, reject) => {
					const interval = setInterval(async () => {
						try {
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

							const release = await this.safeAcquireLock(binPath);
							if (release) {
								clearInterval(interval);
								this.output.debug("Download completed by another process");
								return resolve(release);
							}
						} catch (error) {
							clearInterval(interval);
							reject(error);
						}
					}, 500);
				});
			},
		);
	}
}
