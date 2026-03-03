import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getHeaderArgs } from "../headers";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";

const execFileAsync = promisify(execFile);

/**
 * Returns true on platforms where the OS keyring is supported (macOS, Windows).
 */
export function isKeyringSupported(): boolean {
	return process.platform === "darwin" || process.platform === "win32";
}

/**
 * Delegates credential storage to the Coder CLI to keep the credentials in sync.
 */
export class CliCredentialManager {
	constructor(private readonly logger: Logger) {}

	/**
	 * Store a token by running:
	 *   CODER_SESSION_TOKEN=<token> <bin> login --use-token-as-session <url>
	 *
	 * The token is passed via environment variable so it never appears in
	 * process argument lists.
	 */
	async storeToken(
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
	 * Returns trimmed stdout, or undefined on any failure.
	 */
	async readToken(
		binPath: string,
		url: string,
		configs: Pick<WorkspaceConfiguration, "get">,
	): Promise<string | undefined> {
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
}
