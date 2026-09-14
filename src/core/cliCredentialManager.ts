import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import * as semver from "semver";

import { isAbortError } from "../error/errorUtils";
import { featureSetForVersion, type FeatureSet } from "../featureSet";
import {
	categorizeCredentialError,
	CredentialCliError,
	CredentialTelemetry,
} from "../instrumentation/credentials";
import { recordError } from "../instrumentation/outcomes";
import { type CliAuth, getGlobalFlags, resolveCliAuth } from "../settings/cli";
import { type TelemetryReporter } from "../telemetry/reporter";
import { toSafeHost } from "../util/uri";

import { version } from "./cliExec";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";
import type { Span } from "../telemetry/span";

import type { PathResolver } from "./pathResolver";

const execFileAsync = promisify(execFile);

const EXEC_TIMEOUT_MS = 60_000;
const EXEC_LOG_INTERVAL_MS = 5_000;

interface ResolvedCli {
	binPath: string;
	featureSet: FeatureSet;
	auth: CliAuth;
	flags: string[];
}

/** The downloaded CLI binary for a deployment URL, or undefined when there is none. */
export type BinaryResolver = (
	deploymentUrl: string,
) => Promise<string | undefined>;

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

	/** Stores a token via `coder login`. Skipped until the CLI is downloaded; throws when the CLI fails. */
	public storeToken(
		url: string,
		token: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<void> {
		return this.credentialTelemetry.traceStore(configs, async (span) => {
			const cli = await this.resolveCli(url, configs);
			if (!cli) {
				span.setProperty("outcome", "no_binary");
				this.logger.info(
					"Skipped storing the token in the CLI: it is not downloaded yet",
				);
				return;
			}
			span.setProperty("store", cli.auth.store);
			await this.exec(cli, ["login", "--use-token-as-session", url], {
				env: { ...process.env, CODER_SESSION_TOKEN: token },
				signal: options?.signal,
			});
			span.setProperty("outcome", "stored");
			this.logger.info("Stored token via CLI for", url);
		});
	}

	/** Reads the CLI's token via `coder login token` (CLI 2.32+). Undefined on any failure. */
	public async readToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options?: { signal?: AbortSignal },
	): Promise<string | undefined> {
		try {
			const cli = await this.resolveCli(url, configs);
			if (!cli) {
				this.logger.debug("No CLI session to read: the CLI is not downloaded");
				return undefined;
			}
			if (!cli.featureSet.tokenRead) {
				return undefined;
			}
			return await this.cliToken(cli, options?.signal);
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			this.logger.info(
				"Could not read the CLI session (it may not be signed in):",
				error,
			);
			return undefined;
		}
	}

	/**
	 * True when the CLI's own store holds `token`. Below CLI 2.32 the token
	 * cannot be read back, so the CLI's store counts as holding it. False without a working CLI.
	 */
	public async holdsToken(
		url: string,
		token: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<boolean> {
		try {
			const cli = await this.resolveCli(url, configs);
			if (cli?.auth.store !== "cli") {
				return false;
			}
			return !cli.featureSet.tokenRead || (await this.cliToken(cli)) === token;
		} catch (error) {
			this.logger.warn("Could not read the CLI session:", error);
			return false;
		}
	}

	private async cliToken(
		cli: ResolvedCli,
		signal?: AbortSignal,
	): Promise<string | undefined> {
		const { stdout } = await this.exec(cli, ["login", "token"], { signal });
		return stdout.trim() || undefined;
	}

	/**
	 * Deletes the extension's credential files and runs `coder logout`, which
	 * revokes the token. A shared CLI session is only logged out when
	 * `signOutCli` is set. Returns whether every store was cleared; throws only on abort.
	 */
	public deleteToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		options: { signal?: AbortSignal; signOutCli: boolean },
	): Promise<boolean> {
		return this.credentialTelemetry.traceClear(configs, async (span) => {
			const [filesCleared, cliCleared] = await Promise.all([
				this.deleteCredentialFiles(url),
				this.cliLogout(url, configs, { ...options, span }),
			]);
			return filesCleared && cliCleared;
		});
	}

	private async cliLogout(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
		{
			signal,
			signOutCli,
			span,
		}: { signal?: AbortSignal; signOutCli: boolean; span: Span },
	): Promise<boolean> {
		try {
			const cli = await this.resolveCli(url, configs);
			if (!cli) {
				span.setProperty("outcome", "no_binary");
				this.logger.info("Skipped signing out the CLI: it is not downloaded");
				return true;
			}
			span.setProperty("store", cli.auth.store);
			// The CLI's own session is the user's call; the extension's is always revoked.
			if (cli.auth.store === "cli" && !signOutCli) {
				span.setProperty("outcome", "kept");
				return true;
			}
			await this.exec(cli, ["logout", "--yes"], { signal });
			span.setProperty("outcome", "logged_out");
			this.logger.info("Logged out via CLI for", url);
			return true;
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			this.logger.warn("Failed to log out via CLI:", error);
			recordError(span, categorizeCredentialError(error));
			return false;
		}
	}

	private async resolveCli(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<ResolvedCli | undefined> {
		const binPath = await this.resolveBinary(url);
		if (!binPath) {
			return undefined;
		}
		const featureSet = featureSetForVersion(
			semver.parse(await version(binPath)),
		);
		const configDir = this.pathResolver.getGlobalConfigDir(toSafeHost(url));
		const auth = resolveCliAuth(configs, featureSet, url, configDir);
		return { binPath, featureSet, auth, flags: getGlobalFlags(configs, auth) };
	}

	/** Runs a subcommand with a 60s timeout. Failures become `CredentialCliError`; aborts pass through. */
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
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			throw new CredentialCliError(error);
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
