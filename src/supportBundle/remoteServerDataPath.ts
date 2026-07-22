import * as path from "node:path";
import * as vscode from "vscode";

import {
	getRemoteSshExtension,
	type RemoteSshExtensionId,
} from "../remote/sshExtension";
import { parseRemoteAuthority } from "../util/authority";
import { vscodeProposed } from "../vscodeProposed";

import type { Logger } from "../logging/logger";

interface RemoteServerDataPathOptions {
	readonly remoteAuthority: string;
	/** Product-specific server directory name, such as `.vscode-server`. */
	readonly serverDataFolderName?: string;
	readonly logger: Logger;
}

export interface RemoteServerDataPath {
	readonly value: string;
	readonly style: "posix" | "win32";
}

/** Remote-SSH implementations where `serverInstallPath` names a parent directory. */
const parentInstallPathExtensions: readonly RemoteSshExtensionId[] = [
	"anysphere.remote-ssh",
	"ms-vscode-remote.remote-ssh",
];

/**
 * Resolve the active remote server's data directory when possible.
 *
 * Precedence mirrors the server's own resolution, the `--server-data-dir`
 * flag over `VSCODE_AGENT_FOLDER` over the home default: supported
 * implementations pass `serverInstallPath` as that flag, so its
 * interpretation outranks the environment variable.
 * @see https://github.com/microsoft/vscode/blob/085b6a1465387d070516ba8a640ccfed66417796/src/vs/server/node/server.main.ts#L39
 */
export async function getRemoteServerDataPath({
	remoteAuthority,
	serverDataFolderName,
	logger,
}: RemoteServerDataPathOptions): Promise<RemoteServerDataPath | undefined> {
	const configured = serverDataFolderName
		? getConfiguredServerDataPath(remoteAuthority, serverDataFolderName, logger)
		: undefined;
	return configured ?? getActiveServerDataPath(remoteAuthority, logger);
}

/**
 * Append known editor log locations. Globs always use forward slashes:
 * doublestar only matches on `/`, and the agent normalizes Windows paths
 * to forward slashes before matching.
 */
export function toRemoteLogGlobs({
	value,
	style,
}: RemoteServerDataPath): readonly string[] {
	const base = style === "win32" ? value.replaceAll("\\", "/") : value;
	return [path.posix.join(base, "data", "logs", "**", "*.log")];
}

async function getActiveServerDataPath(
	remoteAuthority: string,
	logger: Logger,
): Promise<RemoteServerDataPath | undefined> {
	try {
		if (!vscodeProposed.workspace.getRemoteExecServer) {
			return undefined;
		}
		const execServer =
			await vscodeProposed.workspace.getRemoteExecServer(remoteAuthority);
		if (!execServer) {
			return undefined;
		}
		const { env, osPlatform } = await execServer.env();
		const value = env.VSCODE_AGENT_FOLDER;
		if (value === undefined) {
			return undefined;
		}
		const style = pathStyleForPlatform(osPlatform);
		if (!isSafeAbsolutePath(value, style)) {
			logger.warn(`Ignoring unsafe VSCODE_AGENT_FOLDER value: ${value}`);
			return undefined;
		}
		return { value, style };
	} catch (error) {
		logger.warn(
			"Could not resolve the remote server data path from the active environment",
			error,
		);
		return undefined;
	}
}

function getConfiguredServerDataPath(
	remoteAuthority: string,
	serverDataFolderName: string,
	logger: Logger,
): RemoteServerDataPath | undefined {
	try {
		const parts = parseRemoteAuthority(remoteAuthority);
		const extensionId = getRemoteSshExtension()?.id;
		if (!parts || !extensionId) {
			return undefined;
		}

		const config = vscode.workspace.getConfiguration("remote.SSH");
		const installPaths = config.get<Record<string, string>>(
			"serverInstallPath",
			{},
		);
		let installPath: string | undefined;
		if (extensionId === "jeanp413.open-remote-ssh") {
			installPath = findOpenRemoteSshInstallPath(parts.sshHost, installPaths);
		} else if (parentInstallPathExtensions.includes(extensionId)) {
			installPath = installPaths[parts.sshHost];
		}
		if (!installPath) {
			return undefined;
		}

		const remotePlatforms = config.get<Record<string, string>>(
			"remotePlatform",
			{},
		);
		const style = configuredPathStyle(
			installPath,
			remotePlatforms[parts.sshHost],
		);
		if (!isSafeAbsolutePath(installPath, style)) {
			logger.warn(
				`Ignoring unsafe remote.SSH.serverInstallPath value: ${installPath}`,
			);
			return undefined;
		}

		if (extensionId === "jeanp413.open-remote-ssh") {
			return { value: installPath, style };
		}

		const remotePath = path[style];
		// Cursor accepts the product folder itself despite documenting a parent.
		// Its installer strips this suffix before consistently re-appending it.
		const parentPath =
			extensionId === "anysphere.remote-ssh" &&
			remotePath.basename(installPath) === serverDataFolderName
				? remotePath.dirname(installPath)
				: installPath;
		return {
			value: remotePath.join(parentPath, serverDataFolderName),
			style,
		};
	} catch (error) {
		logger.warn(
			"Could not resolve the remote server data path from Remote-SSH settings",
			error,
		);
		return undefined;
	}
}

/**
 * Match Open Remote SSH's exact > specific wildcard > `*` precedence.
 * @see https://github.com/jeanp413/open-remote-ssh/blob/3ba888b808bcbf224f71f142072dde0617f55c28/src/serverSetup.ts#L22-L74
 */
function findOpenRemoteSshInstallPath(
	hostname: string,
	pathMap: Readonly<Record<string, string>>,
): string | undefined {
	let bestMatch: { readonly path: string; readonly score: number } | undefined;
	for (const [pattern, installPath] of Object.entries(pathMap)) {
		const score = hostnamePatternScore(hostname, pattern);
		if (score > 0 && (!bestMatch || score > bestMatch.score)) {
			bestMatch = { path: installPath, score };
		}
	}
	return bestMatch?.path;
}

function hostnamePatternScore(hostname: string, pattern: string): number {
	if (hostname === pattern) {
		return 1000;
	}
	if (pattern === "*") {
		return 1;
	}
	const expression = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*");
	return new RegExp(`^${expression}$`).test(hostname)
		? 10 + pattern.replace(/\*/g, "").length
		: -1;
}

function pathStyleForPlatform(platform: string): RemoteServerDataPath["style"] {
	return platform === "win32" || platform === "windows" ? "win32" : "posix";
}

function configuredPathStyle(
	value: string,
	platform: string | undefined,
): RemoteServerDataPath["style"] {
	if (platform) {
		return pathStyleForPlatform(platform);
	}
	// remotePlatform can be absent with RemoteCommand. Only infer Windows for
	// unambiguous drive-letter or UNC paths; every other absolute path is POSIX.
	return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")
		? "win32"
		: "posix";
}

/** Reject variables and glob syntax that could broaden workspace collection. */
export function hasUnsafePathChars(value: string): boolean {
	return /[\0$*?[\]{}]/.test(value);
}

/** Absolute, no unsafe characters, and no `..` segments to traverse out. */
function isSafeAbsolutePath(
	value: string,
	style: RemoteServerDataPath["style"],
): boolean {
	return (
		path[style].isAbsolute(value) &&
		!hasUnsafePathChars(value) &&
		!value.split(/[\\/]/).includes("..")
	);
}
