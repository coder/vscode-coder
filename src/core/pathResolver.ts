import * as path from "node:path";
import * as vscode from "vscode";

export class PathResolver {
	constructor(
		private readonly basePath: string,
		private readonly codeLogPath: string,
	) {}

	/**
	 * Return the directory for the deployment with the provided hostname to
	 * where the global Coder configs are stored.
	 *
	 * If the hostname is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getGlobalConfigDir(safeHostname: string): string {
		return safeHostname
			? path.join(this.basePath, safeHostname)
			: this.basePath;
	}

	/**
	 * Return the directory for a deployment with the provided hostname to where
	 * its binary is cached.
	 *
	 * If the hostname is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getBinaryCachePath(safeHostname: string): string {
		const settingPath = vscode.workspace
			.getConfiguration()
			.get<string>("coder.binaryDestination")
			?.trim();
		const binaryPath =
			settingPath || process.env.CODER_BINARY_DESTINATION?.trim();
		return binaryPath
			? path.normalize(binaryPath)
			: path.join(this.getGlobalConfigDir(safeHostname), "bin");
	}

	/**
	 * Return the path where network information for SSH hosts are stored.
	 *
	 * The CLI will write files here named after the process PID.
	 */
	public getNetworkInfoPath(): string {
		return path.join(this.basePath, "net");
	}

	/**
	 * Return the path where log data from the connection is stored.
	 *
	 * The CLI will write files here named after the process PID.
	 *
	 * Note: This directory is not currently used.
	 */
	public getLogPath(): string {
		return path.join(this.basePath, "log");
	}

	/**
	 * Get the path to the user's settings.json file.
	 *
	 * Going through VSCode's API should be preferred when modifying settings.
	 */
	public getUserSettingsPath(): string {
		return path.join(this.basePath, "..", "..", "..", "User", "settings.json");
	}

	/**
	 * Return the directory for the deployment with the provided hostname to
	 * where its session token is stored.
	 *
	 * If the hostname is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getSessionTokenPath(safeHostname: string): string {
		return path.join(this.getGlobalConfigDir(safeHostname), "session");
	}

	/**
	 * Return the directory for the deployment with the provided hostname to
	 * where its session token was stored by older code.
	 *
	 * If the hostname is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getLegacySessionTokenPath(safeHostname: string): string {
		return path.join(this.getGlobalConfigDir(safeHostname), "session_token");
	}

	/**
	 * Return the directory for the deployment with the provided hostname to
	 * where its url is stored.
	 *
	 * If the hostname is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getUrlPath(safeHostname: string): string {
		return path.join(this.getGlobalConfigDir(safeHostname), "url");
	}

	/**
	 * The URI of a directory in which the extension can create log files.
	 *
	 * The directory might not exist on disk and creation is up to the extension.
	 * However, the parent directory is guaranteed to be existent.
	 *
	 * This directory is provided by VS Code and may not be the same as the directory where the Coder CLI writes its log files.
	 */
	public getCodeLogDir(): string {
		return this.codeLogPath;
	}
}
