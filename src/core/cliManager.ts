import globalAxios, {
	type AxiosInstance,
	type AxiosRequestConfig,
} from "axios";
import { createWriteStream, type WriteStream, type Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import prettyBytes from "pretty-bytes";
import * as semver from "semver";
import * as vscode from "vscode";

import { errToStr } from "../api/api-helper";
import * as pgp from "../pgp";
import { withCancellableProgress, withOptionalProgress } from "../progress";
import { isKeyringEnabled } from "../settings/cli";
import { tempFilePath, toSafeHost } from "../util";
import { vscodeProposed } from "../vscodeProposed";

import { BinaryLock } from "./binaryLock";
import { version as cliVersion } from "./cliExec";
import * as cliUtils from "./cliUtils";
import * as downloadProgress from "./downloadProgress";

import type { Api } from "coder/site/src/api/api";
import type { IncomingMessage } from "node:http";

import type { Logger } from "../logging/logger";

import type { CliCredentialManager } from "./cliCredentialManager";
import type { PathResolver } from "./pathResolver";

type ResolvedBinary =
	| { binPath: string; stat: Stats; source: "file-path" | "directory" }
	| { binPath: string; source: "not-found" };

export class CliManager {
	private readonly binaryLock: BinaryLock;

	constructor(
		private readonly output: Logger,
		private readonly pathResolver: PathResolver,
		private readonly cliCredentialManager: CliCredentialManager,
	) {
		this.binaryLock = new BinaryLock(output);
	}

	/**
	 * Return the path to a cached CLI binary for a deployment URL.
	 * Stat check only, no network, no subprocess. Throws if absent.
	 */
	public async locateBinary(url: string): Promise<string> {
		const safeHostname = toSafeHost(url);
		const resolved = await this.resolveBinaryPath(safeHostname);
		if (resolved.source === "not-found") {
			throw new Error(`No CLI binary found at ${resolved.binPath}`);
		}
		return resolved.binPath;
	}

	/**
	 * Resolve the CLI binary path from the configured cache path.
	 *
	 * Returns "file-path" when the cache path is an existing file (checked for
	 * version match and updated if needed), "directory" when a binary was found
	 * inside the directory, or "not-found" with the platform-specific path for
	 * the caller to download into.
	 */
	private async resolveBinaryPath(
		safeHostname: string,
	): Promise<ResolvedBinary> {
		const cachePath = this.pathResolver.getBinaryCachePath(safeHostname);
		const cacheStat = await cliUtils.stat(cachePath);

		if (cacheStat?.isFile()) {
			return { binPath: cachePath, stat: cacheStat, source: "file-path" };
		}

		const fullNamePath = path.join(cachePath, cliUtils.fullName());

		// Path does not exist yet; return the platform-specific path to download.
		if (!cacheStat) {
			return { binPath: fullNamePath, source: "not-found" };
		}

		// Directory exists; check platform-specific name, then simple name.
		const fullStat = await cliUtils.stat(fullNamePath);
		if (fullStat) {
			return { binPath: fullNamePath, stat: fullStat, source: "directory" };
		}

		const simpleNamePath = path.join(cachePath, cliUtils.simpleName());
		const simpleStat = await cliUtils.stat(simpleNamePath);
		if (simpleStat) {
			return { binPath: simpleNamePath, stat: simpleStat, source: "directory" };
		}

		return { binPath: fullNamePath, source: "not-found" };
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
	public async fetchBinary(restClient: Api): Promise<string> {
		const baseUrl = restClient.getAxiosInstance().defaults.baseURL;
		if (!baseUrl) {
			throw new Error("REST client has no base URL configured");
		}
		const safeHostname = toSafeHost(baseUrl);
		const cfg = vscode.workspace.getConfiguration("coder");
		// Settings can be undefined when set to their defaults (true in this case),
		// so explicitly check against false.
		const enableDownloads = cfg.get("enableDownloads") !== false;
		this.output.debug(
			"Downloads are",
			enableDownloads ? "enabled" : "disabled",
		);

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

		const resolved = await this.resolveBinaryPath(safeHostname);
		this.output.debug(
			`Resolved binary: ${resolved.binPath} (${resolved.source})`,
		);

		let existingVersion: string | null = null;
		if (resolved.source !== "not-found") {
			this.output.debug(
				"Existing binary size is",
				prettyBytes(resolved.stat.size),
			);
			try {
				existingVersion = await cliVersion(resolved.binPath);
				this.output.debug("Existing binary version is", existingVersion);
			} catch (error) {
				this.output.warn(
					"Unable to get version of existing binary, downloading instead",
					error,
				);
			}
		} else {
			this.output.info("No existing binary found, starting download");
		}

		if (existingVersion === buildInfo.version) {
			this.output.debug("Existing binary matches server version");
			return resolved.binPath;
		}

		if (!enableDownloads) {
			if (existingVersion) {
				this.output.info(
					"Using existing binary despite version mismatch because downloads are disabled",
				);
				return resolved.binPath;
			}
			this.output.warn("Unable to download CLI because downloads are disabled");
			throw new Error("Unable to download CLI because downloads are disabled");
		}

		if (existingVersion) {
			this.output.info(
				"Downloading since existing binary does not match the server version",
			);
		}

		// Always download using the platform-specific name.
		const downloadBinPath = path.join(
			path.dirname(resolved.binPath),
			cliUtils.fullName(),
		);

		// Create the `bin` folder if it doesn't exist
		await fs.mkdir(path.dirname(downloadBinPath), { recursive: true });
		const progressLogPath = downloadBinPath + ".progress.log";

		let lockResult:
			| { release: () => Promise<void>; waited: boolean }
			| undefined;
		let latestVersion = parsedVersion;
		try {
			lockResult = await this.binaryLock.acquireLockOrWait(
				downloadBinPath,
				progressLogPath,
			);
			this.output.debug("Acquired download lock");

			// Another process may have finished the download while we waited.
			if (lockResult.waited) {
				const latestBuildInfo = await restClient.getBuildInfo();
				this.output.debug("Got latest server version", latestBuildInfo.version);

				const recheckAfterWait = await this.checkBinaryVersion(
					downloadBinPath,
					latestBuildInfo.version,
				);
				if (recheckAfterWait.matches) {
					this.output.debug("Binary already matches server version after wait");
					return await this.renameToFinalPath(resolved, downloadBinPath);
				}

				const latestParsedVersion = semver.parse(latestBuildInfo.version);
				if (!latestParsedVersion) {
					throw new Error(
						`Got invalid version from deployment: ${latestBuildInfo.version}`,
					);
				}
				latestVersion = latestParsedVersion;
			}

			await this.performBinaryDownload(
				restClient,
				latestVersion,
				downloadBinPath,
				progressLogPath,
			);
			return await this.renameToFinalPath(resolved, downloadBinPath);
		} catch (error) {
			const fallback = await this.handleAnyBinaryFailure(
				error,
				downloadBinPath,
				buildInfo.version,
				resolved.binPath !== downloadBinPath ? resolved.binPath : undefined,
			);
			// Move the fallback to the expected path if needed.
			if (fallback !== resolved.binPath) {
				await fs.rename(fallback, resolved.binPath);
			}
			return resolved.binPath;
		} finally {
			if (lockResult) {
				await lockResult.release();
				this.output.debug("Released download lock");
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
			const version = await cliVersion(binPath);
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
	 * Rename the downloaded binary to the user-configured file path if needed.
	 */
	private async renameToFinalPath(
		resolved: ResolvedBinary,
		downloadBinPath: string,
	): Promise<string> {
		if (
			resolved.source === "file-path" &&
			downloadBinPath !== resolved.binPath
		) {
			this.output.info(
				"Renaming downloaded binary to",
				path.basename(resolved.binPath),
			);
			await fs.rename(downloadBinPath, resolved.binPath);
			return resolved.binPath;
		}
		return downloadBinPath;
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
			{ modal: true, useCustom: true },
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
		const oldBinPath = tempFilePath(binPath, "old");

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
		const version = await cliVersion(binPath);
		this.output.info("Downloaded binary version is", version);
	}

	/**
	 * Try fallback binaries after a download failure, prompting the user once
	 * if the best candidate is a version mismatch.
	 */
	private async handleAnyBinaryFailure(
		error: unknown,
		binPath: string,
		expectedVersion: string,
		fallbackBinPath?: string,
	): Promise<string> {
		const message =
			error instanceof cliUtils.FileLockError
				? "Unable to update the Coder CLI binary because it's in use"
				: "Failed to update CLI binary";

		// Returns the path if usable, undefined if not found.
		// Throws the original error if the user declines a mismatch.
		const tryCandidate = async (
			candidate: string,
		): Promise<string | undefined> => {
			const check = await this.checkBinaryVersion(candidate, expectedVersion);
			if (!check.version) {
				return undefined;
			}
			if (
				!check.matches &&
				!(await this.promptUseExistingBinary(check.version, message))
			) {
				throw error;
			}
			return candidate;
		};

		const primary = await tryCandidate(binPath);
		if (primary) {
			return primary;
		}

		if (fallbackBinPath) {
			const fallback = await tryCandidate(fallbackBinPath);
			if (fallback) {
				return fallback;
			}
		}

		// Last resort: most recent .old-* backup (deferred to avoid IO when unnecessary).
		const oldBinaries = await cliUtils.findOldBinaries(binPath);
		if (oldBinaries.length > 0) {
			const old = await tryCandidate(oldBinaries[0]);
			if (old) {
				return old;
			}
		}

		throw error;
	}

	private async performBinaryDownload(
		restClient: Api,
		parsedVersion: semver.SemVer,
		binPath: string,
		progressLogPath: string,
	): Promise<string> {
		const cfg = vscode.workspace.getConfiguration("coder");
		const tempFile = tempFilePath(binPath, "temp");

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
			const binName = cliUtils.fullName();
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
			headers: {
				...headers,
				"Accept-Encoding": "identity",
			},
			decompress: false,
			// Ignore all errors so we can catch a 404!
			validateStatus: () => true,
		});
		this.output.info("Got status code", resp.status);

		if (resp.status === 200) {
			const rawContentLength = (resp.headers["content-length"] ??
				resp.headers["x-original-content-length"]) as unknown;
			const contentLength = Number.parseInt(
				typeof rawContentLength === "string" ? rawContentLength : "",
				10,
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
					title: `Downloading Coder CLI for ${baseUrl}`,
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
					throw new Error("Signature verification aborted", { cause: error });
				}
				this.output.info("Binary will be ran anyway at user request");
			}
		}
		return status;
	}

	/**
	 * Configure the CLI for the deployment with the provided hostname.
	 *
	 * Stores credentials in the OS keyring when the setting is enabled and the
	 * CLI supports it, otherwise writes plaintext files under --global-config.
	 *
	 * Both URL and token are required. Empty tokens are allowed (e.g. mTLS
	 * authentication) but the URL must be a non-empty string.
	 */
	public async configure(
		url: string,
		token: string,
		options?: { silent?: boolean },
	): Promise<void> {
		if (!url) {
			throw new Error("URL is required to configure the CLI");
		}

		const configs = vscode.workspace.getConfiguration();

		if (options?.silent) {
			try {
				await this.cliCredentialManager.storeToken(url, token, configs);
			} catch (error) {
				this.handleStoreError(error);
			}
			return;
		}

		const result = await withCancellableProgress(
			({ signal }) =>
				this.cliCredentialManager.storeToken(url, token, configs, { signal }),
			{
				location: vscode.ProgressLocation.Notification,
				title: `Storing credentials for ${url}`,
				cancellable: true,
			},
		);
		if (result.ok) {
			return;
		}
		if (result.cancelled) {
			this.output.info("Credential storage cancelled by user");
			return;
		}
		this.handleStoreError(result.error);
	}

	/**
	 * Remove credentials for a deployment. Clears both file-based credentials
	 * and keyring entries (via `coder logout`). All cleanup is best-effort.
	 */
	public async clearCredentials(url: string): Promise<void> {
		const configs = vscode.workspace.getConfiguration();
		const result = await withOptionalProgress(
			({ signal }) =>
				this.cliCredentialManager.deleteToken(url, configs, { signal }),
			{
				enabled: isKeyringEnabled(configs),
				location: vscode.ProgressLocation.Notification,
				title: `Removing credentials for ${url}`,
				cancellable: true,
			},
		);
		if (result.ok) {
			return;
		}
		if (result.cancelled) {
			this.output.info("Credential removal cancelled by user");
		} else {
			this.output.warn("Failed to remove credentials:", result.error);
		}
	}

	private handleStoreError(error: unknown): void {
		this.output.error("Failed to store credentials:", error);
		vscode.window
			.showErrorMessage(
				`Failed to store credentials: ${errToStr(error)}.`,
				"Open Settings",
			)
			.then((action) => {
				if (action === "Open Settings") {
					vscode.commands.executeCommand(
						"workbench.action.openSettings",
						"coder.useKeyring",
					);
				}
			});
		throw error;
	}
}
