import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import {
	getRemoteSshExtension,
	type RemoteSshExtensionId,
} from "../remote/sshExtension";
import { parseRemoteAuthority } from "../util/authority";

import type { Logger } from "../logging/logger";

interface RemoteServerDataPathOptions {
	/** The local editor's install root, `vscode.env.appRoot`. */
	readonly appRoot: string;
	/** Authority identifying the target workspace's SSH host. */
	readonly remoteAuthority?: string;
	readonly logger: Logger;
}

interface ProductConfiguration {
	/**
	 * Name of the server's data directory under the remote user's home
	 * directory, such as `.vscode-server`.
	 * @see https://github.com/microsoft/vscode/blob/085b6a1465387d070516ba8a640ccfed66417796/src/vs/server/node/server.main.ts#L39
	 */
	serverDataFolderName?: unknown;
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
 * Resolve the remote server's data directory.
 *
 * Remote-SSH implementations derive this path from `serverInstallPath` and
 * hand it to the server at launch (as `--server-data-dir` or
 * `VSCODE_AGENT_FOLDER`), so the setting alone resolves it without an
 * active connection.
 * @see https://github.com/microsoft/vscode/blob/085b6a1465387d070516ba8a640ccfed66417796/src/vs/server/node/server.main.ts#L39
 */
export async function getRemoteServerDataPath({
	appRoot,
	remoteAuthority,
	logger,
}: RemoteServerDataPathOptions): Promise<RemoteServerDataPath> {
	const serverDataFolderName = await readServerDataFolderName(appRoot, logger);
	let dataPath: RemoteServerDataPath | undefined;
	if (remoteAuthority && serverDataFolderName) {
		dataPath = getConfiguredServerDataPath(
			remoteAuthority,
			serverDataFolderName,
			logger,
		);
	}
	// The agent expands `~/` against the remote home, the server's default.
	return (
		dataPath ?? {
			value: `~/${serverDataFolderName || ".vscode-remote"}`,
			style: "posix",
		}
	);
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
	const base = escapeGlobChars(
		style === "win32" ? value.replaceAll("\\", "/") : value,
	);
	return [
		path.posix.join(base, "data", "logs", "**", "*.log"),
		path.posix.join(base, ".*.log"),
		path.posix.join(base, "cli", "servers", "*", "log.txt"),
	];
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
		// Devin Desktop / Windsurf and Antigravity have no install path setting; their
		// servers always live in the home default.
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
		const remotePath = path[style];
		// SSH resolves relative paths against home; the agent only expands
		// absolute, `~/`, and environment-variable paths.
		if (!remotePath.isAbsolute(installPath) && !/^[~$%]/.test(installPath)) {
			installPath = `~/${installPath}`;
		}
		if (extensionId === "jeanp413.open-remote-ssh") {
			return { value: installPath, style };
		}

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

/**
 * Escape glob metacharacters so the base path matches literally. Character
 * classes work on every platform, while backslash escapes would be
 * normalized into path separators for Windows agents.
 */
function escapeGlobChars(value: string): string {
	return value.replace(/[*?[{]/g, (char) => `[${char}]`);
}

async function readServerDataFolderName(
	appRoot: string,
	logger: Logger,
): Promise<string | undefined> {
	try {
		const productJson = await fs.readFile(
			path.join(appRoot, "product.json"),
			"utf-8",
		);
		const { serverDataFolderName } = JSON.parse(
			productJson,
		) as ProductConfiguration;
		return typeof serverDataFolderName === "string" && serverDataFolderName
			? serverDataFolderName
			: undefined;
	} catch (error) {
		logger.warn("Could not read the editor's product metadata", error);
		return undefined;
	}
}
