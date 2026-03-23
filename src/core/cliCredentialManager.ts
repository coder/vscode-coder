import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as semver from "semver";

import { isAbortError } from "../error/errorUtils";
import { featureSetForVersion } from "../featureSet";
import { isKeyringEnabled } from "../settings/cli";
import { getHeaderArgs } from "../settings/headers";
import { renameWithRetry, tempFilePath, toSafeHost } from "../util";

import * as cliUtils from "./cliUtils";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";

import type { PathResolver } from "./pathResolver";

const execFileAsync = promisify(execFile);

type KeyringFeature = "keyringAuth" | "keyringTokenRead";

const EXEC_TIMEOUT_MS = 60_000;
const EXEC_LOG_INTERVAL_MS = 5_000;

/**
 * Resolves a CLI binary path for a given deployment URL, fetching/downloading
 * if needed. Returns the path or throws if unavailable.
 */
export type BinaryResolver = (deploymentUrl: string) => Promise<string>;

/**
 * Returns true on platforms where the OS keyring is supported (macOS, Windows).
 */
export function isKeyringSupported(): boolean {
	const platform = os.platform();
	return platform === "darwin" || platform === "win32";
}

/**
 * Delegates credential storage to the Coder CLI. Owns all credential
 * persistence: keyring-backed (via CLI) and file-based (plaintext).
 */
export class CliCredentialManager {
	constructor(
		private readonly logger: Logger,
		private readonly resolveBinary: BinaryResolver,
		private readonly pathResolver: PathResolver,
	) {}

	/**
	 * Store credentials for a deployment URL. Uses the OS keyring when the
	 * setting is enabled and the CLI supports it; otherwise writes plaintext
	 * files under --global-config.
	 *
	 * Keyring and files are mutually exclusive — never both.
	 *
	 * When `keyringOnly` is set, silently returns if the keyring is unavailable
	 * instead of falling back to file storage.
	 */
	public async storeToken(
		url: string,
		token: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal; keyringOnly?: boolean },
	): Promise<void> {
		const binPath = await this.resolveKeyringBinary(
			url,
			configs,
			"keyringAuth",
		);
		if (!binPath) {
			if (options?.keyringOnly) {
				return;
			}
			await this.writeCredentialFiles(url, token);
			return;
		}

		const args = [
			...getHeaderArgs(configs),
			"login",
			"--use-token-as-session",
			url,
		];
		try {
			await this.execWithTimeout(binPath, args, {
				env: { ...process.env, CODER_SESSION_TOKEN: token },
				signal: options?.signal,
			});
			this.logger.info("Stored token via CLI for", url);
		} catch (error) {
			this.logger.warn("Failed to store token via CLI:", error);
			throw error;
		}
	}

	/**
	 * Read a token via `coder login token --url`. Returns trimmed stdout,
	 * or undefined on any failure (resolver, CLI, empty output).
	 * Throws AbortError when the signal is aborted.
	 */
	public async readToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		let binPath: string | undefined;
		try {
			binPath = await this.resolveKeyringBinary(
				url,
				configs,
				"keyringTokenRead",
			);
		} catch (error) {
			this.logger.warn("Could not resolve CLI binary for token read:", error);
			return undefined;
		}
		if (!binPath) {
			return undefined;
		}

		const args = [...getHeaderArgs(configs), "login", "token", "--url", url];
		try {
			const { stdout } = await this.execWithTimeout(binPath, args, {
				signal: options?.signal,
			});
			const token = stdout.trim();
			return token || undefined;
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			this.logger.warn("Failed to read token via CLI:", error);
			return undefined;
		}
	}

	/**
	 * Delete credentials for a deployment. Runs file deletion and keyring
	 * deletion in parallel, both best-effort. Throws AbortError when the
	 * signal is aborted.
	 */
	public async deleteToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<void> {
		await Promise.all([
			this.deleteCredentialFiles(url),
			this.deleteKeyringToken(url, configs, options?.signal),
		]);
	}

	/**
	 * Resolve a CLI binary for keyring operations. Returns the binary path
	 * when keyring is enabled in settings and the CLI version supports the
	 * requested feature, or undefined to fall back to file-based storage.
	 *
	 * Throws on binary resolution or version-check failure (caller decides
	 * whether to catch or propagate).
	 */
	private async resolveKeyringBinary(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		feature: KeyringFeature,
	): Promise<string | undefined> {
		if (!isKeyringEnabled(configs)) {
			return undefined;
		}
		const binPath = await this.resolveBinary(url);
		const version = semver.parse(await cliUtils.version(binPath));
		return featureSetForVersion(version)[feature] ? binPath : undefined;
	}

	/**
	 * Wrap execFileAsync with a 60s timeout and periodic debug logging.
	 */
	private async execWithTimeout(
		binPath: string,
		args: string[],
		options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
	): Promise<{ stdout: string; stderr: string }> {
		const { signal, ...execOptions } = options;
		const timer = setInterval(() => {
			this.logger.debug(`CLI command still running: coder ${args[0]} ...`);
		}, EXEC_LOG_INTERVAL_MS);
		try {
			return await execFileAsync(binPath, args, {
				...execOptions,
				timeout: EXEC_TIMEOUT_MS,
				signal,
			});
		} finally {
			clearInterval(timer);
		}
	}

	/**
	 * Write URL and token files under --global-config.
	 */
	private async writeCredentialFiles(
		url: string,
		token: string,
	): Promise<void> {
		const safeHostname = toSafeHost(url);
		await Promise.all([
			this.atomicWriteFile(this.pathResolver.getUrlPath(safeHostname), url),
			this.atomicWriteFile(
				this.pathResolver.getSessionTokenPath(safeHostname),
				token,
			),
		]);
	}

	/**
	 * Delete URL and token files. Best-effort: never throws.
	 */
	private async deleteCredentialFiles(url: string): Promise<void> {
		const safeHostname = toSafeHost(url);
		const paths = [
			this.pathResolver.getSessionTokenPath(safeHostname),
			this.pathResolver.getUrlPath(safeHostname),
		];
		await Promise.all(
			paths.map((p) =>
				fs.rm(p, { force: true }).catch((error) => {
					this.logger.warn("Failed to remove credential file", p, error);
				}),
			),
		);
	}

	/**
	 * Delete keyring token via `coder logout`. Best-effort: never throws.
	 */
	private async deleteKeyringToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		signal?: AbortSignal,
	): Promise<void> {
		let binPath: string | undefined;
		try {
			binPath = await this.resolveKeyringBinary(url, configs, "keyringAuth");
		} catch (error) {
			this.logger.warn("Could not resolve keyring binary for delete:", error);
			return;
		}
		if (!binPath) {
			return;
		}

		const args = [...getHeaderArgs(configs), "logout", "--url", url, "--yes"];
		try {
			await this.execWithTimeout(binPath, args, { signal });
			this.logger.info("Deleted token via CLI for", url);
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			this.logger.warn("Failed to delete token via CLI:", error);
		}
	}

	/**
	 * Atomically write content to a file via temp-file + rename.
	 */
	private async atomicWriteFile(
		filePath: string,
		content: string,
	): Promise<void> {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		const tempPath = tempFilePath(filePath, "temp");
		try {
			await fs.writeFile(tempPath, content, { mode: 0o600 });
			await renameWithRetry(fs.rename, tempPath, filePath);
		} catch (err) {
			await fs.rm(tempPath, { force: true }).catch((rmErr) => {
				this.logger.warn("Failed to delete temp file", tempPath, rmErr);
			});
			throw err;
		}
	}
}
