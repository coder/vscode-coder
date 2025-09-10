import fs from "fs/promises";
import path from "path";
import { PathResolver } from "./pathResolver";

export class CliConfigManager {
	constructor(private readonly pathResolver: PathResolver) {}

	/**
	 * Configure the CLI for the deployment with the provided label.
	 *
	 * Falsey URLs and null tokens are a no-op; we avoid unconfiguring the CLI to
	 * avoid breaking existing connections.
	 */
	public async configure(
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
			const urlPath = this.pathResolver.getUrlPath(label);
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
			const tokenPath = this.pathResolver.getSessionTokenPath(label);
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
	public async readConfig(
		label: string,
	): Promise<{ url: string; token: string }> {
		const urlPath = this.pathResolver.getUrlPath(label);
		const tokenPath = this.pathResolver.getSessionTokenPath(label);
		const [url, token] = await Promise.allSettled([
			fs.readFile(urlPath, "utf8"),
			fs.readFile(tokenPath, "utf8"),
		]);
		return {
			url: url.status === "fulfilled" ? url.value.trim() : "",
			token: token.status === "fulfilled" ? token.value.trim() : "",
		};
	}
}
