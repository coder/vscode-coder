import globalAxios, {
	type AxiosInstance,
	type AxiosRequestConfig,
} from "axios";
import { Api } from "coder/site/src/api/api";
import { createWriteStream, type WriteStream } from "fs";
import fs from "fs/promises";
import { IncomingMessage } from "http";
import path from "path";
import prettyBytes from "pretty-bytes";
import * as semver from "semver";
import * as vscode from "vscode";
import { errToStr } from "./api-helper";
import * as cli from "./cliManager";
import { getHeaderCommand, getHeaders } from "./headers";
import * as pgp from "./pgp";

// Maximium number of recent URLs to store.
const MAX_URLS = 10;

export class Storage {
	constructor(
		private readonly vscodeProposed: typeof vscode,
		public readonly output: vscode.LogOutputChannel,
		private readonly memento: vscode.Memento,
		private readonly secrets: vscode.SecretStorage,
		private readonly globalStorageUri: vscode.Uri,
		private readonly logUri: vscode.Uri,
	) {}

	/**
	 * Add the URL to the list of recently accessed URLs in global storage, then
	 * set it as the last used URL.
	 *
	 * If the URL is falsey, then remove it as the last used URL and do not touch
	 * the history.
	 */
	public async setUrl(url?: string): Promise<void> {
		await this.memento.update("url", url);
		if (url) {
			const history = this.withUrlHistory(url);
			await this.memento.update("urlHistory", history);
		}
	}

	/**
	 * Get the last used URL.
	 */
	public getUrl(): string | undefined {
		return this.memento.get("url");
	}

	/**
	 * Get the most recently accessed URLs (oldest to newest) with the provided
	 * values appended.  Duplicates will be removed.
	 */
	public withUrlHistory(...append: (string | undefined)[]): string[] {
		const val = this.memento.get("urlHistory");
		const urls = Array.isArray(val) ? new Set(val) : new Set();
		for (const url of append) {
			if (url) {
				// It might exist; delete first so it gets appended.
				urls.delete(url);
				urls.add(url);
			}
		}
		// Slice off the head if the list is too large.
		return urls.size > MAX_URLS
			? Array.from(urls).slice(urls.size - MAX_URLS, urls.size)
			: Array.from(urls);
	}

	/**
	 * Set or unset the last used token.
	 */
	public async setSessionToken(sessionToken?: string): Promise<void> {
		if (!sessionToken) {
			await this.secrets.delete("sessionToken");
		} else {
			await this.secrets.store("sessionToken", sessionToken);
		}
	}

	/**
	 * Get the last used token.
	 */
	public async getSessionToken(): Promise<string | undefined> {
		try {
			return await this.secrets.get("sessionToken");
		} catch (ex) {
			// The VS Code session store has become corrupt before, and
			// will fail to get the session token...
			return undefined;
		}
	}

	/**
	 * Returns the log path for the "Remote - SSH" output panel.  There is no VS
	 * Code API to get the contents of an output panel.  We use this to get the
	 * active port so we can display network information.
	 */
	public async getRemoteSSHLogPath(): Promise<string | undefined> {
		const upperDir = path.dirname(this.logUri.fsPath);
		// Node returns these directories sorted already!
		const dirs = await fs.readdir(upperDir);
		const latestOutput = dirs
			.reverse()
			.filter((dir) => dir.startsWith("output_logging_"));
		if (latestOutput.length === 0) {
			return undefined;
		}
		const dir = await fs.readdir(path.join(upperDir, latestOutput[0]));
		const remoteSSH = dir.filter((file) => file.indexOf("Remote - SSH") !== -1);
		if (remoteSSH.length === 0) {
			return undefined;
		}
		return path.join(upperDir, latestOutput[0], remoteSSH[0]);
	}

	/**
	 * Download and return the path to a working binary for the deployment with
	 * the provided label using the provided client.  If the label is empty, use
	 * the old deployment-unaware path instead.
	 *
	 * If there is already a working binary and it matches the server version,
	 * return that, skipping the download.  If it does not match but downloads are
	 * disabled, return whatever we have and log a warning.  Otherwise throw if
	 * unable to download a working binary, whether because of network issues or
	 * downloads being disabled.
	 */
	public async fetchBinary(restClient: Api, label: string): Promise<string> {
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
		const binPath = path.join(this.getBinaryCachePath(label), cli.name());
		this.output.info("Using binary path", binPath);
		const stat = await cli.stat(binPath);
		if (stat === undefined) {
			this.output.info("No existing binary found, starting download");
		} else {
			this.output.info("Existing binary size is", prettyBytes(stat.size));
			try {
				const version = await cli.version(binPath);
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
					`Unable to get version of existing binary: ${error}. Downloading new binary instead`,
				);
			}
		}

		if (!enableDownloads) {
			this.output.warn("Unable to download CLI because downloads are disabled");
			throw new Error("Unable to download CLI because downloads are disabled");
		}

		// Remove any left-over old or temporary binaries and signatures.
		const removed = await cli.rmOld(binPath);
		removed.forEach(({ fileName, error }) => {
			if (error) {
				this.output.warn("Failed to remove", fileName, error);
			} else {
				this.output.info("Removed", fileName);
			}
		});

		// Figure out where to get the binary.
		const binName = cli.name();
		const configSource = cfg.get("binarySource");
		const binSource =
			configSource && String(configSource).trim().length > 0
				? String(configSource)
				: "/bin/" + binName;
		this.output.info("Downloading binary from", binSource);

		// Ideally we already caught that this was the right version and returned
		// early, but just in case set the ETag.
		const etag = stat !== undefined ? await cli.eTag(binPath) : "";
		this.output.info("Using ETag", etag);

		// Download the binary to a temporary file.
		await fs.mkdir(path.dirname(binPath), { recursive: true });
		const tempFile =
			binPath + ".temp-" + Math.random().toString(36).substring(8);
		const writeStream = createWriteStream(tempFile, {
			autoClose: true,
			mode: 0o755,
		});
		const client = restClient.getAxiosInstance();
		const status = await this.download(client, binSource, writeStream, {
			"Accept-Encoding": "gzip",
			"If-None-Match": `"${etag}"`,
		});

		switch (status) {
			case 200: {
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

				// Move the old binary to a backup location first, just in case.  And,
				// on Linux at least, you cannot write onto a binary that is in use so
				// moving first works around that (delete would also work).
				if (stat !== undefined) {
					const oldBinPath =
						binPath + ".old-" + Math.random().toString(36).substring(8);
					this.output.info(
						"Moving existing binary to",
						path.basename(oldBinPath),
					);
					await fs.rename(binPath, oldBinPath);
				}

				// Then move the temporary binary into the right place.
				this.output.info("Moving downloaded file to", path.basename(binPath));
				await fs.mkdir(path.dirname(binPath), { recursive: true });
				await fs.rename(tempFile, binPath);

				// For debugging, to see if the binary only partially downloaded.
				const newStat = await cli.stat(binPath);
				this.output.info(
					"Downloaded binary size is",
					prettyBytes(newStat?.size || 0),
				);

				// Make sure we can execute this new binary.
				const version = await cli.version(binPath);
				this.output.info("Downloaded binary version is", version);

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
						const os = cli.goos();
						const arch = cli.goarch();
						const params = new URLSearchParams({
							title: `Support the \`${os}-${arch}\` platform`,
							body: `I'd like to use the \`${os}-${arch}\` architecture with the VS Code extension.`,
						});
						const uri = vscode.Uri.parse(
							`https://github.com/coder/vscode-coder/issues/new?` +
								params.toString(),
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
							title: `Failed to download binary on \`${cli.goos()}-${cli.goarch()}\``,
							body: `Received status code \`${status}\` when downloading the binary.`,
						});
						const uri = vscode.Uri.parse(
							`https://github.com/coder/vscode-coder/issues/new?` +
								params.toString(),
						);
						vscode.env.openExternal(uri);
					});
				throw new Error("Failed to download binary");
			}
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
			const rawContentLength = resp.headers["content-length"];
			const contentLength = Number.parseInt(rawContentLength);
			if (Number.isNaN(contentLength)) {
				this.output.warn(
					"Got invalid or missing content length",
					rawContentLength,
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
			const action = await this.vscodeProposed.window.showWarningMessage(
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
				const action = await this.vscodeProposed.window.showWarningMessage(
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
	 * Return the directory for a deployment with the provided label to where its
	 * binary is cached.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getBinaryCachePath(label: string): string {
		const configPath = vscode.workspace
			.getConfiguration()
			.get("coder.binaryDestination");
		return configPath && String(configPath).trim().length > 0
			? path.resolve(String(configPath))
			: label
				? path.join(this.globalStorageUri.fsPath, label, "bin")
				: path.join(this.globalStorageUri.fsPath, "bin");
	}

	/**
	 * Return the path where network information for SSH hosts are stored.
	 *
	 * The CLI will write files here named after the process PID.
	 */
	public getNetworkInfoPath(): string {
		return path.join(this.globalStorageUri.fsPath, "net");
	}

	/**
	 *
	 * Return the path where log data from the connection is stored.
	 *
	 * The CLI will write files here named after the process PID.
	 */
	public getLogPath(): string {
		return path.join(this.globalStorageUri.fsPath, "log");
	}

	/**
	 * Get the path to the user's settings.json file.
	 *
	 * Going through VSCode's API should be preferred when modifying settings.
	 */
	public getUserSettingsPath(): string {
		return path.join(
			this.globalStorageUri.fsPath,
			"..",
			"..",
			"..",
			"User",
			"settings.json",
		);
	}

	/**
	 * Return the directory for the deployment with the provided label to where
	 * its session token is stored.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getSessionTokenPath(label: string): string {
		return label
			? path.join(this.globalStorageUri.fsPath, label, "session")
			: path.join(this.globalStorageUri.fsPath, "session");
	}

	/**
	 * Return the directory for the deployment with the provided label to where
	 * its session token was stored by older code.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getLegacySessionTokenPath(label: string): string {
		return label
			? path.join(this.globalStorageUri.fsPath, label, "session_token")
			: path.join(this.globalStorageUri.fsPath, "session_token");
	}

	/**
	 * Return the directory for the deployment with the provided label to where
	 * its url is stored.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getUrlPath(label: string): string {
		return label
			? path.join(this.globalStorageUri.fsPath, label, "url")
			: path.join(this.globalStorageUri.fsPath, "url");
	}

	/**
	 * Configure the CLI for the deployment with the provided label.
	 *
	 * Falsey URLs and null tokens are a no-op; we avoid unconfiguring the CLI to
	 * avoid breaking existing connections.
	 */
	public async configureCli(
		label: string,
		url: string | undefined,
		token: string | null,
	) {
		await Promise.all([
			this.updateUrlForCli(label, url),
			this.updateTokenForCli(label, token),
		]);
	}

	/**
	 * Update the URL for the deployment with the provided label on disk which can
	 * be used by the CLI via --url-file.  If the URL is falsey, do nothing.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 */
	private async updateUrlForCli(
		label: string,
		url: string | undefined,
	): Promise<void> {
		if (url) {
			const urlPath = this.getUrlPath(label);
			await fs.mkdir(path.dirname(urlPath), { recursive: true });
			await fs.writeFile(urlPath, url);
		}
	}

	/**
	 * Update the session token for a deployment with the provided label on disk
	 * which can be used by the CLI via --session-token-file.  If the token is
	 * null, do nothing.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 */
	private async updateTokenForCli(
		label: string,
		token: string | undefined | null,
	) {
		if (token !== null) {
			const tokenPath = this.getSessionTokenPath(label);
			await fs.mkdir(path.dirname(tokenPath), { recursive: true });
			await fs.writeFile(tokenPath, token ?? "");
		}
	}

	/**
	 * Read the CLI config for a deployment with the provided label.
	 *
	 * IF a config file does not exist, return an empty string.
	 *
	 * If the label is empty, read the old deployment-unaware config.
	 */
	public async readCliConfig(
		label: string,
	): Promise<{ url: string; token: string }> {
		const urlPath = this.getUrlPath(label);
		const tokenPath = this.getSessionTokenPath(label);
		const [url, token] = await Promise.allSettled([
			fs.readFile(urlPath, "utf8"),
			fs.readFile(tokenPath, "utf8"),
		]);
		return {
			url: url.status === "fulfilled" ? url.value.trim() : "",
			token: token.status === "fulfilled" ? token.value.trim() : "",
		};
	}

	/**
	 * Migrate the session token file from "session_token" to "session", if needed.
	 */
	public async migrateSessionToken(label: string) {
		const oldTokenPath = this.getLegacySessionTokenPath(label);
		const newTokenPath = this.getSessionTokenPath(label);
		try {
			await fs.rename(oldTokenPath, newTokenPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
				return;
			}
			throw error;
		}
	}

	/**
	 * Run the header command and return the generated headers.
	 */
	public async getHeaders(
		url: string | undefined,
	): Promise<Record<string, string>> {
		return getHeaders(
			url,
			getHeaderCommand(vscode.workspace.getConfiguration()),
			this.output,
		);
	}
}
