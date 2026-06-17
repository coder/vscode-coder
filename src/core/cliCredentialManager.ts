import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as semver from "semver";

import { isAbortError } from "../error/errorUtils";
import { featureSetForVersion, type FeatureSet } from "../featureSet";
import {
	CredentialCliError,
	CredentialFileError,
	CredentialTelemetry,
} from "../instrumentation/credentials";
import { isKeyringEnabled } from "../settings/cli";
import { getHeaderArgs } from "../settings/headers";
import { type TelemetryReporter } from "../telemetry/reporter";
import { removeTrailingSlashes, toSafeHost } from "../uri/utils";
import { writeAtomically } from "../util/fs";

import { version } from "./cliExec";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";
import type { Span } from "../telemetry/span";

import type { PathResolver } from "./pathResolver";

const execFileAsync = promisify(execFile);

type KeyringFeature = "keyringAuth" | "keyringTokenRead";
type TokenReadSource =
	| { mode: "files" }
	| { mode: "keyring"; binPath: string }
	| { mode: "none" };

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
	private readonly credentialTelemetry: CredentialTelemetry;

	constructor(
		private readonly logger: Logger,
		private readonly resolveBinary: BinaryResolver,
		private readonly pathResolver: PathResolver,
		telemetry: TelemetryReporter,
	) {
		this.credentialTelemetry = new CredentialTelemetry(telemetry);
	}

	/**
	 * Store credentials for a deployment URL. Uses the OS keyring when the
	 * setting is enabled and the CLI supports it; otherwise writes plaintext
	 * files under --global-config.
	 *
	 * Keyring and files are mutually exclusive, never both.
	 */
	public storeToken(
		url: string,
		token: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<void> {
		return this.credentialTelemetry.traceStore(configs, async (span) => {
			const binPath = await this.resolveKeyringBinary(
				url,
				configs,
				"keyringAuth",
			);
			if (!binPath) {
				span.setProperty("category", "file");
				await this.writeCredentialFiles(url, token);
				return;
			}
			span.setProperty("category", "keyring");
			await this.storeKeyringToken(binPath, url, token, configs, options);
		});
	}

	private async storeKeyringToken(
		binPath: string,
		url: string,
		token: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<void> {
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
			if (isAbortError(error)) {
				throw error;
			}
			throw new CredentialCliError(error);
		}
	}

	/**
	 * Read a token from CLI-managed credentials. Uses `coder login token --url`
	 * when keyring auth is active, otherwise reads the file credentials under
	 * --global-config. Returns undefined on any failure (resolver, CLI, empty
	 * output). Throws AbortError when the signal is aborted.
	 */
	public async readToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		const source = await this.resolveTokenReadSource(url, configs);
		if (source.mode === "files") {
			return this.readCredentialFiles(url);
		}
		if (source.mode === "none") {
			return undefined;
		}
		return this.readKeyringToken(source.binPath, url, configs, options);
	}

	private async readKeyringToken(
		binPath: string,
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		const args = [...getHeaderArgs(configs), "login", "token", "--url", url];
		try {
			const { stdout } = await this.execWithTimeout(binPath, args, {
				signal: options?.signal,
			});
			return nonEmpty(stdout);
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
	public deleteToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<void> {
		return this.credentialTelemetry.traceClear(configs, async (span) => {
			await Promise.all([
				this.deleteCredentialFiles(url),
				this.deleteKeyringToken(url, configs, {
					signal: options?.signal,
					span,
				}),
			]);
		});
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
		return (await this.getFeatureSet(binPath))[feature] ? binPath : undefined;
	}

	private async resolveTokenReadSource(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<TokenReadSource> {
		if (!isKeyringEnabled(configs)) {
			return { mode: "files" };
		}
		try {
			const binPath = await this.resolveBinary(url);
			const featureSet = await this.getFeatureSet(binPath);
			if (!featureSet.keyringAuth) {
				return { mode: "files" };
			}
			return featureSet.keyringTokenRead
				? { mode: "keyring", binPath }
				: { mode: "none" };
		} catch (error) {
			this.logger.warn("Could not resolve CLI binary for token read:", error);
			return { mode: "none" };
		}
	}

	private async getFeatureSet(binPath: string): Promise<FeatureSet> {
		return featureSetForVersion(semver.parse(await version(binPath)));
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
		try {
			const safeHostname = toSafeHost(url);
			await Promise.all([
				this.atomicWriteFile(this.pathResolver.getUrlPath(safeHostname), url),
				this.atomicWriteFile(
					this.pathResolver.getSessionTokenPath(safeHostname),
					token,
				),
			]);
		} catch (error) {
			throw new CredentialFileError(error);
		}
	}

	/**
	 * Read URL and token files under --global-config.
	 */
	private async readCredentialFiles(url: string): Promise<string | undefined> {
		try {
			const files = await this.readCredentialFilePair(url);
			return sameCredentialUrl(files.url, url)
				? nonEmpty(files.token)
				: undefined;
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
				this.logger.warn("Failed to read credential files:", error);
			}
			return undefined;
		}
	}

	private async readCredentialFilePair(
		url: string,
	): Promise<{ url: string; token: string }> {
		const safeHostname = toSafeHost(url);
		const [storedUrl, token] = await Promise.all([
			fs.readFile(this.pathResolver.getUrlPath(safeHostname), "utf8"),
			fs.readFile(this.pathResolver.getSessionTokenPath(safeHostname), "utf8"),
		]);
		return { url: storedUrl, token };
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
	 * Delete keyring token via `coder logout`. Best-effort: records the failure
	 * on the span instead of throwing (except on abort), so it is tagged where
	 * it occurs.
	 */
	private async deleteKeyringToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		{ signal, span }: { signal?: AbortSignal; span: Span },
	): Promise<void> {
		let binPath: string | undefined;
		try {
			binPath = await this.resolveKeyringBinary(url, configs, "keyringAuth");
		} catch (error) {
			this.logger.warn("Could not resolve keyring binary for delete:", error);
			span.setProperty("error.type", "binary");
			span.markError();
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
			span.setProperty("error.type", "cli");
			span.markError();
		}
	}

	/** Atomically write content to a file. */
	private async atomicWriteFile(
		filePath: string,
		content: string,
	): Promise<void> {
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await writeAtomically(
			filePath,
			(tempPath) => fs.writeFile(tempPath, content, { mode: 0o600 }),
			(rmErr, tempPath) =>
				this.logger.warn("Failed to delete temp file", tempPath, rmErr),
		);
	}
}

function sameCredentialUrl(storedUrl: string, expectedUrl: string): boolean {
	return cleanCredentialUrl(storedUrl) === cleanCredentialUrl(expectedUrl);
}

function cleanCredentialUrl(url: string): string {
	return removeTrailingSlashes(url.trim());
}

function nonEmpty(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed || undefined;
}
