import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isKeyringEnabled } from "../cliConfig";
import { getHeaderArgs } from "../headers";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";

const execFileAsync = promisify(execFile);

/**
 * Resolves a CLI binary path for a given deployment URL, fetching/downloading
 * if needed. Returns the path or throws if unavailable.
 */
export type BinaryResolver = (url: string) => Promise<string>;

/**
 * Returns true on platforms where the OS keyring is supported (macOS, Windows).
 */
export function isKeyringSupported(): boolean {
	return process.platform === "darwin" || process.platform === "win32";
}

/**
 * Delegates credential storage to the Coder CLI. All operations resolve the
 * binary via the injected BinaryResolver before invoking it.
 */
export class CliCredentialManager {
	constructor(
		private readonly logger: Logger,
		private readonly resolveBinary: BinaryResolver,
	) {}

	/**
	 * Store a token via `coder login --use-token-as-session`.
	 * Token is passed via CODER_SESSION_TOKEN env var, never in args.
	 */
	public async storeToken(
		url: string,
		token: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<void> {
		let binPath: string;
		try {
			binPath = await this.resolveBinary(url);
		} catch (error) {
			this.logger.debug("Could not resolve CLI binary for token store:", error);
			throw error;
		}

		const args = [
			...getHeaderArgs(configs),
			"login",
			"--use-token-as-session",
			url,
		];
		try {
			await execFileAsync(binPath, args, {
				env: { ...process.env, CODER_SESSION_TOKEN: token },
			});
			this.logger.info("Stored token via CLI for", url);
		} catch (error) {
			this.logger.debug("Failed to store token via CLI:", error);
			throw error;
		}
	}

	/**
	 * Read a token via `coder login token --url`. Returns trimmed stdout,
	 * or undefined on any failure (resolver, CLI, empty output).
	 */
	public async readToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<string | undefined> {
		if (!isKeyringEnabled(configs)) {
			return undefined;
		}

		let binPath: string;
		try {
			binPath = await this.resolveBinary(url);
		} catch (error) {
			this.logger.debug("Could not resolve CLI binary for token read:", error);
			return undefined;
		}

		const args = [...getHeaderArgs(configs), "login", "token", "--url", url];
		try {
			const { stdout } = await execFileAsync(binPath, args);
			const token = stdout.trim();
			return token || undefined;
		} catch (error) {
			this.logger.debug("Failed to read token via CLI:", error);
			return undefined;
		}
	}

	/**
	 * Delete a token via `coder logout --url`. Best-effort: never throws.
	 */
	public async deleteToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<void> {
		if (!isKeyringEnabled(configs)) {
			return;
		}

		let binPath: string;
		try {
			binPath = await this.resolveBinary(url);
		} catch (error) {
			this.logger.debug(
				"Could not resolve CLI binary for token delete:",
				error,
			);
			return;
		}

		const args = [...getHeaderArgs(configs), "logout", "--url", url, "--yes"];
		try {
			await execFileAsync(binPath, args);
			this.logger.info("Deleted token via CLI for", url);
		} catch (error) {
			this.logger.debug("Failed to delete token via CLI:", error);
		}
	}
}
