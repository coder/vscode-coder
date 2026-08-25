import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { expandPath } from "../util";
import { currentEditorId } from "../util/authority";

/** Extension of generated SSH config files; the include glob matches on it. */
export const SSH_CONFIG_EXT = ".conf";

/** The per-user data dir of the platform, shared by every editor. */
function platformDataDir(): string {
	switch (process.platform) {
		case "win32":
			return (
				process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
			);
		case "darwin":
			return path.join(os.homedir(), "Library", "Application Support");
		default:
			return (
				process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
			);
	}
}

export class PathResolver {
	constructor(
		private readonly basePath: string,
		private readonly codeLogPath: string,
	) {}

	/**
	 * Per-deployment directory for the extension's Coder configs. A user
	 * `--global-config` in `coder.globalFlags` redirects the CLI; this stays the
	 * default. Caller must ensure it exists.
	 */
	public getGlobalConfigDir(safeHostname: string): string {
		return path.join(this.basePath, safeHostname);
	}

	/**
	 * Return the directory for a deployment with the provided hostname to where
	 * its binary is cached.
	 *
	 * The caller must ensure this directory exists before use.
	 */
	public getBinaryCachePath(safeHostname: string): string {
		return (
			PathResolver.resolveOverride(
				"coder.binaryDestination",
				"CODER_BINARY_DESTINATION",
			) || path.join(this.getGlobalConfigDir(safeHostname), "bin")
		);
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
	 * Directory of generated SSH configs, glob-included from the user's config.
	 * Lives in the platform data dir so every editor emits the same include.
	 */
	public getSshConfigDir(): string {
		return path.join(platformDataDir(), "coder.coder-remote", "ssh");
	}

	/**
	 * Generated SSH config for one deployment, named after the editor in the
	 * host prefix rather than the one writing it: two files declaring the same
	 * host pattern would leave glob order to decide which one ssh reads.
	 */
	public getSshConfigPath(
		safeHostname: string,
		editorId: string = currentEditorId(),
	): string {
		return path.join(
			this.getSshConfigDir(),
			`${editorId}--${safeHostname}${SSH_CONFIG_EXT}`,
		);
	}

	/** The deployment hostname if `editorId` named the file, else undefined. */
	public parseSshConfigFile(
		fileName: string,
		editorId: string = currentEditorId(),
	): string | undefined {
		const prefix = `${editorId}--`;
		return fileName.startsWith(prefix) && fileName.endsWith(SSH_CONFIG_EXT)
			? fileName.slice(prefix.length, -SSH_CONFIG_EXT.length)
			: undefined;
	}

	/**
	 * Return the directory where telemetry files are written.
	 */
	public getTelemetryPath(): string {
		return path.join(this.basePath, "telemetry");
	}

	/**
	 * Return the proxy log directory from the `coder.proxyLogDirectory` setting
	 * or the `CODER_SSH_LOG_DIR` environment variable, falling back to the `log`
	 * subdirectory inside the extension's global storage path.
	 *
	 * The CLI will write files here named after the process PID.
	 */
	public getProxyLogPath(): string {
		return (
			PathResolver.resolveOverride(
				"coder.proxyLogDirectory",
				"CODER_SSH_LOG_DIR",
			) || path.join(this.basePath, "log")
		);
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
	 * The caller must ensure this directory exists before use.
	 */
	public getSessionTokenPath(safeHostname: string): string {
		return path.join(this.getGlobalConfigDir(safeHostname), "session");
	}

	/**
	 * Return the directory for the deployment with the provided hostname to
	 * where its session token was stored by older code.
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

	/**
	 * Read a path from a VS Code setting then an environment variable, returning
	 * the first non-empty value after trimming, tilde/variable expansion, and
	 * normalization. Returns an empty string when neither source provides a path.
	 */
	private static resolveOverride(setting: string, envVar: string): string {
		const fromSetting = expandPath(
			vscode.workspace.getConfiguration().get<string>(setting)?.trim() ?? "",
		);
		const resolved =
			fromSetting || expandPath(process.env[envVar]?.trim() ?? "");
		return resolved ? path.normalize(resolved) : "";
	}
}
