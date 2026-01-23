import globalAxios, {
	type AxiosInstance,
	type AxiosRequestConfig,
} from "axios";
import { type Api } from "coder/site/src/api/api";
import { createWriteStream, type WriteStream } from "node:fs";
import fs from "node:fs/promises";
import { type IncomingMessage } from "node:http";
import path from "node:path";
import prettyBytes from "pretty-bytes";
import * as semver from "semver";
import * as vscode from "vscode";

import { errToStr } from "../api/api-helper";
import { type Logger } from "../logging/logger";
import * as pgp from "../pgp";
import { vscodeProposed } from "../vscodeProposed";

import { BinaryLock } from "./binaryLock";
import * as cliUtils from "./cliUtils";
import * as downloadProgress from "./downloadProgress";
import { type PathResolver } from "./pathResolver";

export class CliManager {
	private readonly binaryLock: BinaryLock;

	constructor(
		private readonly output: Logger,
		private readonly pathResolver: PathResolver,
	) {
		this.binaryLock = new BinaryLock(output);
	}

	/**
	 * Download and return the path to a working binary for the deployment with
	 * the provided hostname using the provided client.  If the hostname is empty,
	 * use the old deployment-unaware path instead.
	 *
	 * If there is already a working binary and it matches the server version,
	 * return that, skipping the download.  If it does not match but downloads are
	 * disabled, return whatever we have and log a warning.  Otherwise throw if
	 * unable to download a working binary, whether because of network issues or
	 * downloads being disabled.
	 */
	public async fetchBinary(
		restClient: Api,
		safeHostname: string,
	): Promise<string> {
		const cfg = vscode.workspace.getConfiguration("coder");
		// Settings can be undefined when set to their defaults (true in this case),
		// so explicitly check against false.
		const enableDownloads = cfg.get("enableDownloads") !== false;
		this.output.info("Downloads are", enableDownloads ? "enabled" : "disabled");

		// Get the build info to compare with the existing binary version, if any,
		// and to log for debugging.
		const buildInfo = await restClient.getBuildInfo();
		this.output.info("Got server version", buildInfo.version);
		const parsedVersion = semver.parse(buildInfo.version);
		if (!parsedVersion) {
			throw new Error(
				`Got invalid version from deployment: ${buildInfo.version}`,
			);
		}

		// Check if there is an existing binary and whether it looks valid.  If it
		// is valid and matches the server, or if it does not match the server but
		// downloads are disabled, we can return early.
		const binPath = path.join(
			this.pathResolver.getBinaryCachePath(safeHostname),
			cliUtils.name(),
		);
		this.output.info("Using binary path", binPath);
		const stat = await cliUtils.stat(binPath);
		if (stat === undefined) {
			this.output.info("No existing binary found, starting download");
		} else {
			this.output.info("Existing binary size is", prettyBytes(stat.size));
			try {
				const version = await cliUtils.version(binPath);
				this.output.info("Existing binary version is", version);
				// If we have the right version we can avoid the request entirely.
				if (version === buildInfo.version) {
					this.output.info(
						"Using existing binary since it matches the server version",
					);
					return binPath;
				} else if (!enableDownloads) {
					this.output.info(
						"Using existing binary even though it does not match the server version because downloads are disabled",
					);
					return binPath;
				}
				this.output.info(
					"Downloading since existing binary does not match the server version",
				);
			} catch (error) {
				this.output.warn(
					"Unable to get version of existing binary. Downloading new binary instead",
					error,
				);
			}
		}

		if (!enableDownloads) {
			this.output.warn("Unable to download CLI because downloads are disabled");
			throw new Error("Unable to download CLI because downloads are disabled");
		}

		// Create the `bin` folder if it doesn't exist
		await fs.mkdir(path.dirname(binPath), { recursive: true });
		const progressLogPath = binPath + ".progress.log";

		let lockResult:
			| { release: () => Promise<void>; waited: boolean }
			| undefined;
		let latestVersion = parsedVersion;
		try {
			lockResult = await this.binaryLock.acquireLockOrWait(
				binPath,
				progressLogPath,
			);
			this.output.info("Acquired download lock");

			// If we waited for another process, re-check if binary is now ready
			if (lockResult.waited) {
				const latestBuildInfo = await restClient.getBuildInfo();
				this.output.info("Got latest server version", latestBuildInfo.version);

				const recheckAfterWait = await this.checkBinaryVersion(
					binPath,
					latestBuildInfo.version,
				);
				if (recheckAfterWait.matches) {
					this.output.info(
						"Using existing binary since it matches the latest server version",
					);
					return binPath;
				}

				// Parse the latest version for download
				const latestParsedVersion = semver.parse(latestBuildInfo.version);
				if (!latestParsedVersion) {
					throw new Error(
						`Got invalid version from deployment: ${latestBuildInfo.version}`,
					);
				}
				latestVersion = latestParsedVersion;
			}

			return await this.performBinaryDownload(
				restClient,
				latestVersion,
				binPath,
				progressLogPath,
			);
		} catch (error) {
			// Unified error handling - check for fallback binaries and prompt user
			return await this.handleAnyBinaryFailure(
				error,
				binPath,
				buildInfo.version,
			);
		} finally {
			if (lockResult) {
				await lockResult.release();
				this.output.info("Released download lock");
			}
		}
	}

	/**
	 * Check if a binary exists and matches the expected version.
	 */
	private async checkBinaryVersion(
		binPath: string,
		expectedVersion: string,
	): Promise<{ version: string | null; matches: boolean }> {
		const stat = await cliUtils.stat(binPath);
		if (!stat) {
			return { version: null, matches: false };
		}

		try {
			const version = await cliUtils.version(binPath);
			return {
				version,
				matches: version === expectedVersion,
			};
		} catch (error) {
			this.output.warn(`Unable to get version of binary: ${errToStr(error)}`);
			return { version: null, matches: false };
		}
	}

	/**
	 * Prompt the user to use an existing binary version.
	 */
	private async promptUseExistingBinary(
		version: string,
		reason: string,
	): Promise<boolean> {
		const choice = await vscodeProposed.window.showErrorMessage(
			`${reason}. Run version ${version} anyway?`,
			"Run",
		);
		return choice === "Run";
	}

	/**
	 * Replace the existing binary with the downloaded temp file.
	 * Throws WindowsFileLockError if binary is in use.
	 */
	private async replaceExistingBinary(
		binPath: string,
		tempFile: string,
	): Promise<void> {
		const oldBinPath =
			binPath + ".old-" + Math.random().toString(36).substring(8);

		try {
			// Step 1: Move existing binary to backup (if it exists)
			const stat = await cliUtils.stat(binPath);
			if (stat) {
				this.output.info(
					"Moving existing binary to",
					path.basename(oldBinPath),
				);
				await fs.rename(binPath, oldBinPath);
			}

			// Step 2: Move temp to final location
			this.output.info("Moving downloaded file to", path.basename(binPath));
			await fs.rename(tempFile, binPath);
		} catch (error) {
			throw cliUtils.maybeWrapFileLockError(error, binPath);
		}

		// For debugging, to see if the binary only partially downloaded.
		const newStat = await cliUtils.stat(binPath);
		this.output.info(
			"Downloaded binary size is",
			prettyBytes(newStat?.size ?? 0),
		);

		// Make sure we can execute this new binary.
		const version = await cliUtils.version(binPath);
		this.output.info("Downloaded binary version is", version);
	}

	/**
	 * Unified handler for any binary-related failure.
	 * Checks for existing or old binaries and prompts user once.
	 */
	private async handleAnyBinaryFailure(
		error: unknown,
		binPath: string,
		expectedVersion: string,
	): Promise<string> {
		const message =
			error instanceof cliUtils.FileLockError
				? "Unable to update the Coder CLI binary because it's in use"
				: "Failed to update CLI binary";

		// Try existing binary first
		const existingCheck = await this.checkBinaryVersion(
			binPath,
			expectedVersion,
		);
		if (existingCheck.version) {
			// Perfect match - use without prompting
			if (existingCheck.matches) {
				return binPath;
			}
			// Version mismatch - prompt user
			if (await this.promptUseExistingBinary(existingCheck.version, message)) {
				return binPath;
			}
			throw error;
		}

		// Try .old-* binaries as fallback
		const oldBinaries = await cliUtils.findOldBinaries(binPath);
		if (oldBinaries.length > 0) {
			const oldCheck = await this.checkBinaryVersion(
				oldBinaries[0],
				expectedVersion,
			);
			if (
				oldCheck.version &&
				(oldCheck.matches ||
					(await this.promptUseExistingBinary(oldCheck.version, message)))
			) {
				await fs.rename(oldBinaries[0], binPath);
				return binPath;
			}
		}

		// No fallback available or user declined - re-throw original error
		throw error;
	}

	private async performBinaryDownload(
		restClient: Api,
		parsedVersion: semver.SemVer,
		binPath: string,
		progressLogPath: string,
	): Promise<string> {
		const cfg = vscode.workspace.getConfiguration("coder");
		const tempFile =
			binPath + ".temp-" + Math.random().toString(36).substring(8);

		try {
			const removed = await cliUtils.rmOld(binPath);
			for (const { fileName, error } of removed) {
				if (error) {
					this.output.warn("Failed to remove", fileName, error);
				} else {
					this.output.info("Removed", fileName);
				}
			}

			// Figure out where to get the binary.
			const binName = cliUtils.name();
			const configSource = cfg.get<string>("binarySource");
			const binSource = configSource?.trim() ? configSource : "/bin/" + binName;
			this.output.info("Downloading binary from", binSource);

			// Ideally we already caught that this was the right version and returned
			// early, but just in case set the ETag.
			const stat = await cliUtils.stat(binPath);
			const etag = stat ? await cliUtils.eTag(binPath) : "";
			this.output.info("Using ETag", etag || "<N/A>");

			// Download the binary to a temporary file.
			const writeStream = createWriteStream(tempFile, {
				autoClose: true,
				mode: 0o755,
			});

			const onProgress = async (
				bytesDownloaded: number,
				totalBytes: number | null,
			) => {
				await downloadProgress.writeProgress(progressLogPath, {
					bytesDownloaded,
					totalBytes,
					status: "downloading",
				});
			};

			const client = restClient.getAxiosInstance();
			const status = await this.download(
				client,
				binSource,
				writeStream,
				{
					"Accept-Encoding": "gzip",
					"If-None-Match": `"${etag}"`,
				},
				onProgress,
			);

			switch (status) {
				case 200: {
					await downloadProgress.writeProgress(progressLogPath, {
						bytesDownloaded: 0,
						totalBytes: null,
						status: "verifying",
					});

					if (cfg.get("disableSignatureVerification")) {
						this.output.info(
							"Skipping binary signature verification due to settings",
						);
					} else {
						await this.verifyBinarySignatures(client, tempFile, [
							// A signature placed at the same level as the binary.  It must be
							// named exactly the same with an appended `.asc` (such as
							// coder-windows-amd64.exe.asc or coder-linux-amd64.asc).
							binSource + ".asc",
							// The releases.coder.com bucket does not include the leading "v",
							// and unlike what we get from buildinfo it uses a truncated version
							// with only major.minor.patch.  The signature name follows the same
							// rule as above.
							`https://releases.coder.com/coder-cli/${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}/${binName}.asc`,
						]);
					}

					// Replace existing binary (handles both renames + Windows lock)
					await this.replaceExistingBinary(binPath, tempFile);

					return binPath;
				}
				case 304: {
					this.output.info("Using existing binary since server returned a 304");
					return binPath;
				}
				case 404: {
					vscode.window
						.showErrorMessage(
							"Coder isn't supported for your platform. Please open an issue, we'd love to support it!",
							"Open an Issue",
						)
						.then((value) => {
							if (!value) {
								return;
							}
							const os = cliUtils.goos();
							const arch = cliUtils.goarch();
							const params = new URLSearchParams({
								title: `Support the \`${os}-${arch}\` platform`,
								body: `I'd like to use the \`${os}-${arch}\` architecture with the VS Code extension.`,
							});
							const uri = vscode.Uri.parse(
								`https://github.com/coder/vscode-coder/issues/new?${params.toString()}`,
							);
							vscode.env.openExternal(uri);
						});
					throw new Error("Platform not supported");
				}
				default: {
					vscode.window
						.showErrorMessage(
							"Failed to download binary. Please open an issue.",
							"Open an Issue",
						)
						.then((value) => {
							if (!value) {
								return;
							}
							const params = new URLSearchParams({
								title: `Failed to download binary on \`${cliUtils.goos()}-${cliUtils.goarch()}\``,
								body: `Received status code \`${status}\` when downloading the binary.`,
							});
							const uri = vscode.Uri.parse(
								`https://github.com/coder/vscode-coder/issues/new?${params.toString()}`,
							);
							vscode.env.openExternal(uri);
						});
					throw new Error("Failed to download binary");
				}
			}
		} finally {
			await downloadProgress.clearProgress(progressLogPath);
		}
	}

	/**
	 * Download the source to the provided stream with a progress dialog.  Return
	 * the status code or throw if the user aborts or there is an error.
	 */
	private async download(
		client: AxiosInstance,
		source: string,
		writeStream: WriteStream,
		headers?: AxiosRequestConfig["headers"],
		onProgress?: (
			bytesDownloaded: number,
			totalBytes: number | null,
		) => Promise<void>,
	): Promise<number> {
		const baseUrl = client.defaults.baseURL;

		const controller = new AbortController();
		const resp = await client.get(source, {
			signal: controller.signal,
			baseURL: baseUrl,
			responseType: "stream",
			headers,
			decompress: true,
			// Ignore all errors so we can catch a 404!
			validateStatus: () => true,
		});
		this.output.info("Got status code", resp.status);

		if (resp.status === 200) {
			const rawContentLength = resp.headers["content-length"] as unknown;
			const contentLength = Number.parseInt(
				typeof rawContentLength === "string" ? rawContentLength : "",
			);
			if (Number.isNaN(contentLength)) {
				this.output.warn(
					"Got invalid or missing content length",
					rawContentLength ?? "",
				);
			} else {
				this.output.info("Got content length", prettyBytes(contentLength));
			}

			// Track how many bytes were written.
			let written = 0;

			const completed = await vscode.window.withProgress<boolean>(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Downloading ${baseUrl}`,
					cancellable: true,
				},
				async (progress, token) => {
					const readStream = resp.data as IncomingMessage;
					let cancelled = false;
					token.onCancellationRequested(() => {
						controller.abort();
						readStream.destroy();
						cancelled = true;
					});

					// Reverse proxies might not always send a content length.
					const contentLengthPretty = Number.isNaN(contentLength)
						? "unknown"
						: prettyBytes(contentLength);

					// Pipe data received from the request to the stream.
					readStream.on("data", (buffer: Buffer) => {
						writeStream.write(buffer, () => {
							written += buffer.byteLength;
							progress.report({
								message: `${prettyBytes(written)} / ${contentLengthPretty}`,
								increment: Number.isNaN(contentLength)
									? undefined
									: (buffer.byteLength / contentLength) * 100,
							});
							if (onProgress) {
								onProgress(
									written,
									Number.isNaN(contentLength) ? null : contentLength,
								).catch((error) => {
									this.output.warn(
										"Failed to write progress log:",
										errToStr(error),
									);
								});
							}
						});
					});

					// Wait for the stream to end or error.
					return new Promise<boolean>((resolve, reject) => {
						writeStream.on("error", (error) => {
							readStream.destroy();
							reject(
								new Error(
									`Unable to download binary: ${errToStr(error, "no reason given")}`,
								),
							);
						});
						readStream.on("error", (error) => {
							writeStream.close();
							reject(
								new Error(
									`Unable to download binary: ${errToStr(error, "no reason given")}`,
								),
							);
						});
						readStream.on("close", () => {
							writeStream.close();
							if (cancelled) {
								resolve(false);
							} else {
								resolve(true);
							}
						});
					});
				},
			);

			// False means the user canceled, although in practice it appears we
			// would not get this far because VS Code already throws on cancelation.
			if (!completed) {
				this.output.warn("User aborted download");
				throw new Error("Download aborted");
			}

			this.output.info(`Downloaded ${prettyBytes(written)}`);
		}

		return resp.status;
	}

	/**
	 * Download detached signatures one at a time and use them to verify the
	 * binary.  The first signature is always downloaded, but the next signatures
	 * are only tried if the previous ones did not exist and the user indicates
	 * they want to try the next source.
	 *
	 * If the first successfully downloaded signature is valid or it is invalid
	 * and the user indicates to use the binary anyway, return, otherwise throw.
	 *
	 * If no signatures could be downloaded, return if the user indicates to use
	 * the binary anyway, otherwise throw.
	 */
	private async verifyBinarySignatures(
		client: AxiosInstance,
		cliPath: string,
		sources: string[],
	): Promise<void> {
		const publicKeys = await pgp.readPublicKeys(this.output);
		for (let i = 0; i < sources.length; ++i) {
			const source = sources[i];
			// For the primary source we use the common client, but for the rest we do
			// not to avoid sending user-provided headers to external URLs.
			if (i === 1) {
				client = globalAxios.create();
			}
			const status = await this.verifyBinarySignature(
				client,
				cliPath,
				publicKeys,
				source,
			);
			if (status === 200) {
				return;
			}
			// If we failed to download, try the next source.
			let nextPrompt = "";
			const options: string[] = [];
			const nextSource = sources[i + 1];
			if (nextSource) {
				nextPrompt = ` Would you like to download the signature from ${nextSource}?`;
				options.push("Download signature");
			}
			options.push("Run without verification");
			const action = await vscodeProposed.window.showWarningMessage(
				status === 404 ? "Signature not found" : "Failed to download signature",
				{
					useCustom: true,
					modal: true,
					detail:
						status === 404
							? `No binary signature was found at ${source}.${nextPrompt}`
							: `Received ${status} trying to download binary signature from ${source}.${nextPrompt}`,
				},
				...options,
			);
			switch (action) {
				case "Download signature": {
					continue;
				}
				case "Run without verification":
					this.output.info(`Signature download from ${nextSource} declined`);
					this.output.info("Binary will be ran anyway at user request");
					return;
				default:
					this.output.info(`Signature download from ${nextSource} declined`);
					this.output.info("Binary was rejected at user request");
					throw new Error("Signature download aborted");
			}
		}
		// Reaching here would be a developer error.
		throw new Error("Unable to download any signatures");
	}

	/**
	 * Download a detached signature and if successful (200 status code) use it to
	 * verify the binary.  Throw if the binary signature is invalid and the user
	 * declined to run the binary, otherwise return the status code.
	 */
	private async verifyBinarySignature(
		client: AxiosInstance,
		cliPath: string,
		publicKeys: pgp.Key[],
		source: string,
	): Promise<number> {
		this.output.info("Downloading signature from", source);
		const signaturePath = path.join(cliPath + ".asc");
		const writeStream = createWriteStream(signaturePath);
		const status = await this.download(client, source, writeStream);
		if (status === 200) {
			try {
				await pgp.verifySignature(
					publicKeys,
					cliPath,
					signaturePath,
					this.output,
				);
			} catch (error) {
				const action = await vscodeProposed.window.showWarningMessage(
					// VerificationError should be the only thing that throws, but
					// unfortunately caught errors are always type unknown.
					error instanceof pgp.VerificationError
						? error.summary()
						: "Failed to verify signature",
					{
						useCustom: true,
						modal: true,
						detail: `${errToStr(error)} Would you like to accept this risk and run the binary anyway?`,
					},
					"Run anyway",
				);
				if (!action) {
					this.output.info("Binary was rejected at user request");
					throw new Error("Signature verification aborted");
				}
				this.output.info("Binary will be ran anyway at user request");
			}
		}
		return status;
	}

	/**
	 * Configure the CLI for the deployment with the provided hostname.
	 *
	 * Falsey URLs and null tokens are a no-op; we avoid unconfiguring the CLI to
	 * avoid breaking existing connections.
	 */
	public async configure(
		safeHostname: string,
		url: string | undefined,
		token: string | null,
	) {
		await Promise.all([
			this.updateUrlForCli(safeHostname, url),
			this.updateTokenForCli(safeHostname, token),
		]);
	}

	/**
	 * Update the URL for the deployment with the provided hostname on disk which
	 * can be used by the CLI via --url-file.  If the URL is falsey, do nothing.
	 *
	 * If the hostname is empty, read the old deployment-unaware config instead.
	 */
	private async updateUrlForCli(
		safeHostname: string,
		url: string | undefined,
	): Promise<void> {
		if (url) {
			const urlPath = this.pathResolver.getUrlPath(safeHostname);
			await this.atomicWriteFile(urlPath, url);
		}
	}

	/**
	 * Update the session token for a deployment with the provided hostname on
	 * disk which can be used by the CLI via --session-token-file.  If the token
	 * is null, do nothing.
	 *
	 * If the hostname is empty, read the old deployment-unaware config instead.
	 */
	private async updateTokenForCli(safeHostname: string, token: string | null) {
		if (token !== null) {
			const tokenPath = this.pathResolver.getSessionTokenPath(safeHostname);
			await this.atomicWriteFile(tokenPath, token);
		}
	}

	/**
	 * Atomically write content to a file by writing to a temporary file first,
	 * then renaming it.
	 */
	private async atomicWriteFile(
		filePath: string,
		content: string,
	): Promise<void> {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		const tempPath =
			filePath + ".temp-" + Math.random().toString(36).substring(8);
		try {
			await fs.writeFile(tempPath, content);
			await fs.rename(tempPath, filePath);
		} catch (err) {
			await fs.rm(tempPath, { force: true }).catch((rmErr) => {
				this.output.warn("Failed to delete temp file", tempPath, rmErr);
			});
			throw err;
		}
	}
}
