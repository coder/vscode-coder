import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import * as semver from "semver";

import { isAbortError } from "../error/errorUtils";
import { featureSetForVersion, type FeatureSet } from "../featureSet";
import {
	CredentialCliError,
	CredentialTelemetry,
} from "../instrumentation/credentials";
import { type CliAuth, getGlobalFlags, resolveCliAuth } from "../settings/cli";
import { type TelemetryReporter } from "../telemetry/reporter";
import { toSafeHost } from "../util/uri";

import { version } from "./cliExec";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";
import type { Span } from "../telemetry/span";

import type { PathResolver } from "./pathResolver";
import type { SessionAuth } from "./secretsManager";

const execFileAsync = promisify(execFile);

const EXEC_TIMEOUT_MS = 60_000;
const EXEC_LOG_INTERVAL_MS = 5_000;

interface ResolvedCli {
	binPath: string;
	featureSet: FeatureSet;
	auth: CliAuth;
	flags: string[];
}

/**
 * Resolves a CLI binary path for a given deployment URL, fetching/downloading
 * if needed. Returns the path or throws if unavailable.
 */
export type BinaryResolver = (deploymentUrl: string) => Promise<string>;

/** Stores, reads, and deletes credentials through `coder login` and `coder logout`. */
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

	/** Stores a token via `coder login`. Throws when the binary or the CLI fails. */
	public storeToken(
		url: string,
		token: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<void> {
		return this.credentialTelemetry.traceStore(configs, async (span) => {
			const cli = await this.resolveCli(url, configs);
			span.setProperty("store", cli.auth.store);
			try {
				await this.exec(cli, ["login", "--use-token-as-session", url], {
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
		});
	}

	/** Reads the CLI's token via `coder login token` (CLI 2.31+). Undefined on any failure. */
	public async readToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		let cli: ResolvedCli;
		try {
			cli = await this.resolveCli(url, configs);
		} catch (error) {
			this.logger.warn("Could not resolve CLI binary:", error);
			return undefined;
		}
		if (!cli.featureSet.tokenRead) {
			return undefined;
		}
		return this.readCliToken(cli, options?.signal);
	}

	private async readCliToken(
		cli: ResolvedCli,
		signal: AbortSignal | undefined,
	): Promise<string | undefined> {
		try {
			const { stdout } = await this.exec(cli, ["login", "token"], { signal });
			return stdout.trim() || undefined;
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			this.logger.warn("Failed to read token via CLI:", error);
			return undefined;
		}
	}

	/**
	 * Deletes the extension's credential files and runs `coder logout` when the
	 * CLI session is ours (see `ownsCliSession`). Returns whether every store
	 * was cleared; throws only on abort.
	 */
	public deleteToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		session: SessionAuth | undefined,
		options?: { signal?: AbortSignal },
	): Promise<boolean> {
		return this.credentialTelemetry.traceClear(configs, async (span) => {
			const [filesCleared, cliCleared] = await Promise.all([
				this.deleteCredentialFiles(url),
				this.cliLogout(url, configs, session, {
					signal: options?.signal,
					span,
				}),
			]);
			return filesCleared && cliCleared;
		});
	}

	private async cliLogout(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		session: SessionAuth | undefined,
		{ signal, span }: { signal?: AbortSignal; span: Span },
	): Promise<boolean> {
		let cli: ResolvedCli;
		try {
			cli = await this.resolveCli(url, configs);
		} catch (error) {
			this.logger.warn("Could not resolve CLI binary for logout:", error);
			span.setProperty("error.type", "binary");
			span.markError();
			return false;
		}
		span.setProperty("store", cli.auth.store);
		if (!(await this.ownsCliSession(cli, session, signal))) {
			this.logger.info("Kept the CLI session for", url);
			return true;
		}
		try {
			await this.exec(cli, ["logout", "--yes"], { signal });
			this.logger.info("Logged out via CLI for", url);
			return true;
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			this.logger.warn("Failed to log out via CLI:", error);
			span.setProperty("error.type", "cli");
			span.markError();
			return false;
		}
	}

	/** A shared store is ours only if the CLI still holds the token this extension created. */
	private async ownsCliSession(
		cli: ResolvedCli,
		session: SessionAuth | undefined,
		signal: AbortSignal | undefined,
	): Promise<boolean> {
		if (cli.auth.store === "private") {
			return true;
		}
		if (session?.tokenSource !== "extension") {
			return false;
		}
		// Below 2.31 the CLI cannot report its token; trust the provenance.
		if (!cli.featureSet.tokenRead) {
			return true;
		}
		const cliToken = await this.readCliToken(cli, signal);
		return cliToken === session.token;
	}

	private async resolveCli(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<ResolvedCli> {
		const binPath = await this.resolveBinary(url);
		const featureSet = featureSetForVersion(
			semver.parse(await version(binPath)),
		);
		const configDir = this.pathResolver.getGlobalConfigDir(toSafeHost(url));
		const auth = resolveCliAuth(configs, featureSet, url, configDir);
		return { binPath, featureSet, auth, flags: getGlobalFlags(configs, auth) };
	}

	/** Runs a subcommand with a 60s timeout and periodic debug logging. */
	private async exec(
		cli: ResolvedCli,
		args: string[],
		options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal },
	): Promise<{ stdout: string; stderr: string }> {
		const timer = setInterval(() => {
			this.logger.debug(`CLI command still running: coder ${args[0]} ...`);
		}, EXEC_LOG_INTERVAL_MS);
		try {
			return await execFileAsync(cli.binPath, [...cli.flags, ...args], {
				...options,
				timeout: EXEC_TIMEOUT_MS,
			});
		} finally {
			clearInterval(timer);
		}
	}

	/** Removes the url and session files. Never throws. */
	private async deleteCredentialFiles(url: string): Promise<boolean> {
		const safeHostname = toSafeHost(url);
		const paths = [
			this.pathResolver.getSessionTokenPath(safeHostname),
			this.pathResolver.getUrlPath(safeHostname),
		];
		const results = await Promise.all(
			paths.map((p) =>
				fs.rm(p, { force: true }).then(
					() => true,
					(error) => {
						this.logger.warn("Failed to remove credential file", p, error);
						return false;
					},
				),
			),
		);
		return results.every(Boolean);
	}
}
