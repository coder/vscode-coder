import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
 * Delegates credential storage to the Coder CLI to keep the credentials in sync.
 *
 * For operations that don't have a binary path available (readToken, deleteToken),
 * uses the injected BinaryResolver to fetch/locate the CLI binary.
 */
export class CliCredentialManager {
	constructor(
		private readonly logger: Logger,
		private readonly resolveBinary: BinaryResolver,
	) {}

	/**
	 * Store a token by running:
	 *   CODER_SESSION_TOKEN=<token> <bin> login --use-token-as-session <url>
	 *
	 * The token is passed via environment variable so it never appears in
	 * process argument lists.
	 */
	public async storeToken(
		binPath: string,
		url: string,
		token: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<void> {
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
			this.logger.error("Failed to store token via CLI:", error);
			throw error;
		}
	}

	/**
	 * Read a token by running:
	 *   <bin> login token --url <url>
	 *
	 * Resolves the CLI binary automatically. Returns trimmed stdout,
	 * or undefined if the binary can't be resolved or the CLI returns no token.
	 */
	public async readToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<string | undefined> {
		let binPath: string;
		try {
			binPath = await this.resolveBinary(url);
		} catch (error) {
			this.logger.warn("Could not resolve CLI binary for token read:", error);
			return undefined;
		}

		const args = [...getHeaderArgs(configs), "login", "token", "--url", url];
		try {
			const { stdout } = await execFileAsync(binPath, args);
			const token = stdout.trim();
			return token || undefined;
		} catch (error) {
			this.logger.warn("Failed to read token via CLI:", error);
			return undefined;
		}
	}

	/**
	 * Delete a token by running:
	 *   <bin> logout --url <url>
	 *
	 * Resolves the CLI binary automatically. Best-effort: logs warnings
	 * on failure but never throws.
	 */
	async deleteToken(
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<void> {
		let binPath: string;
		try {
			binPath = await this.resolveBinary(url);
		} catch (error) {
			this.logger.warn("Could not resolve CLI binary for token delete:", error);
			return;
		}

		const args = [...getHeaderArgs(configs), "logout", "--url", url, "--yes"];
		try {
			await execFileAsync(binPath, args);
			this.logger.info("Deleted token via CLI for", url);
		} catch (error) {
			this.logger.warn("Failed to delete token via CLI:", error);
		}
	}
}
