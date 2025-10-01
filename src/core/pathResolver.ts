import * as path from "path";
import * as vscode from "vscode";

export class PathResolver {
	constructor(
		private readonly basePath: string,
		private readonly codeLogPath: string,
	) {}

	/**
	 * Return the directory for the deployment with the provided label to where
	 * the global Coder configs are stored.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getGlobalConfigDir(label: string): string {
		return label ? path.join(this.basePath, label) : this.basePath;
	}

	/**
	 * Return the directory for a deployment with the provided label to where its
	 * binary is cached.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getBinaryCachePath(label: string): string {
		const settingPath = vscode.workspace
			.getConfiguration()
			.get<string>("coder.binaryDestination")
			?.trim();
		const binaryPath =
			settingPath || process.env.CODER_BINARY_DESTINATION?.trim();
		return binaryPath
			? path.normalize(binaryPath)
			: path.join(this.getGlobalConfigDir(label), "bin");
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
	 * Return the directory for the deployment with the provided label to where
	 * its session token is stored.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getSessionTokenPath(label: string): string {
		return path.join(this.getGlobalConfigDir(label), "session");
	}

	/**
	 * Return the directory for the deployment with the provided label to where
	 * its session token was stored by older code.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getLegacySessionTokenPath(label: string): string {
		return path.join(this.getGlobalConfigDir(label), "session_token");
	}

	/**
	 * Return the directory for the deployment with the provided label to where
	 * its url is stored.
	 *
	 * If the label is empty, read the old deployment-unaware config instead.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getUrlPath(label: string): string {
		return path.join(this.getGlobalConfigDir(label), "url");
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
