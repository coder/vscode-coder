import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import * as semver from "semver";

import { isAbortError } from "../error/errorUtils";
import { featureSetForVersion, type FeatureSet } from "../featureSet";
import {
	CredentialCliError,
	CredentialTelemetry,
} from "../instrumentation/credentials";
import { getGlobalFlags, isKeyringEnabled } from "../settings/cli";
import { getHeaderArgs } from "../settings/headers";
import { type TelemetryReporter } from "../telemetry/reporter";
import { toSafeHost } from "../util/uri";

import { version } from "./cliExec";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";
import type { Span } from "../telemetry/span";

import type { PathResolver } from "./pathResolver";

const execFileAsync = promisify(execFile);

// keyring uses the CLI's default store; cli-file passes --global-config.
type CliTransport =
	| { kind: "keyring"; binPath: string }
	| { kind: "cli-file"; binPath: string; allowOverride: boolean };

type ReadTransport = CliTransport | { kind: "none" };

export interface CliCredential {
	token: string;
	source: "keyring" | "files";
}

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
 * Delegates credential storage to the Coder CLI, both keyring-backed and
 * file-based, via `coder login`/`coder logout`.
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
	 * Store credentials via `coder login` (keyring or file-backed). Throws if the
	 * CLI binary cannot be resolved.
	 */
	public storeToken(
		url: string,
		token: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<void> {
		return this.credentialTelemetry.traceStore(configs, async (span) => {
			const transport = await this.resolveWriteTransport(url, configs);
			span.setProperty(
				"category",
				transport.kind === "keyring" ? "keyring" : "file",
			);
			await this.cliLogin(transport, url, token, configs, options);
		});
	}

	private async cliLogin(
		transport: CliTransport,
		url: string,
		token: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<void> {
		const args = [
			...this.credentialGlobalFlags(transport, url, configs),
			"login",
			"--use-token-as-session",
			url,
		];
		try {
			await this.execWithTimeout(transport.binPath, args, {
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
	 * Read a token via `coder login token` (keyring or file-backed). Requires
	 * 2.31.0+; older deployments return undefined. Returns the token and its
	 * source, or undefined on any failure. Throws AbortError on abort.
	 */
	public async readToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<CliCredential | undefined> {
		const transport = await this.resolveReadTransport(url, configs);
		if (transport.kind === "none") {
			return undefined;
		}
		const args = [
			...this.credentialGlobalFlags(transport, url, configs),
			"login",
			"token",
			"--url",
			url,
		];
		const token = await this.runTokenRead(transport.binPath, args, options);
		if (!token) {
			return undefined;
		}
		return {
			token,
			source: transport.kind === "keyring" ? "keyring" : "files",
		};
	}

	private async runTokenRead(
		binPath: string,
		args: string[],
		options?: { signal?: AbortSignal },
	): Promise<string | undefined> {
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
	 * Delete credentials for a deployment. Removes the default-dir files and
	 * logs out of the active store (keyring or file via --global-config), both
	 * best-effort. Throws AbortError when the signal is aborted.
	 */
	public deleteToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<void> {
		return this.credentialTelemetry.traceClear(configs, async (span) => {
			await Promise.all([
				this.deleteCredentialFiles(url),
				this.cliLogout(url, configs, { signal: options?.signal, span }),
			]);
		});
	}

	/**
	 * Log out via `coder logout`, keyring or file (--global-config). Records
	 * failures on the span instead of throwing (except on abort).
	 */
	private async cliLogout(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		{ signal, span }: { signal?: AbortSignal; span: Span },
	): Promise<void> {
		let transport: CliTransport;
		try {
			transport = await this.resolveWriteTransport(url, configs);
		} catch (error) {
			this.logger.warn("Could not resolve CLI binary for logout:", error);
			span.setProperty("error.type", "binary");
			span.markError();
			return;
		}
		const args = [
			...this.credentialGlobalFlags(transport, url, configs),
			"logout",
			"--url",
			url,
			"--yes",
		];
		try {
			await this.execWithTimeout(transport.binPath, args, { signal });
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

	/** Resolve the CLI binary and its feature set, or throw if unavailable. */
	private async resolveCli(
		url: string,
	): Promise<{ binPath: string; featureSet: FeatureSet }> {
		const binPath = await this.resolveBinary(url);
		return { binPath, featureSet: await this.getFeatureSet(binPath) };
	}

	private async resolveWriteTransport(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<CliTransport> {
		const cli = await this.resolveCli(url);
		if (isKeyringEnabled(configs) && cli.featureSet.keyringAuth) {
			return { kind: "keyring", binPath: cli.binPath };
		}
		return cliFileTransport(cli);
	}

	private async resolveReadTransport(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<ReadTransport> {
		// Reading is best-effort: a missing binary means no CLI credentials.
		const cli = await this.resolveCli(url).catch((error) => {
			this.logger.warn("Could not resolve CLI binary:", error);
			return undefined;
		});
		if (!cli) {
			return { kind: "none" };
		}
		if (isKeyringEnabled(configs) && cli.featureSet.keyringAuth) {
			return cli.featureSet.tokenRead
				? { kind: "keyring", binPath: cli.binPath }
				: { kind: "none" };
		}
		if (cli.featureSet.tokenRead) {
			return cliFileTransport(cli);
		}
		return { kind: "none" };
	}

	/** Keyring uses the default store; file mode passes --global-config. */
	private credentialGlobalFlags(
		transport: CliTransport,
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): string[] {
		if (transport.kind === "keyring") {
			return getHeaderArgs(configs);
		}
		return getGlobalFlags(configs, {
			mode: "global-config",
			configDir: this.pathResolver.getGlobalConfigDir(toSafeHost(url)),
			allowOverride: transport.allowOverride,
		});
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
}

function cliFileTransport(cli: {
	binPath: string;
	featureSet: FeatureSet;
}): CliTransport {
	// Override applies only once read+write are CLI-mediated (2.31+), matching
	// resolveCliAuth.
	return {
		kind: "cli-file",
		binPath: cli.binPath,
		allowOverride: cli.featureSet.tokenRead,
	};
}

function nonEmpty(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed || undefined;
}
