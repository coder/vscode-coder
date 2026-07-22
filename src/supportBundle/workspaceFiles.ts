import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
	getRemoteServerDataPath,
	hasUnsafePathChars,
	toRemoteLogGlobs,
} from "./remoteServerDataPath";

import type { Logger } from "../logging/logger";

interface ProductConfiguration {
	/**
	 * Default remote server data directory beneath the user's home directory.
	 * @see https://github.com/microsoft/vscode/blob/085b6a1465387d070516ba8a640ccfed66417796/src/vs/server/node/server.main.ts#L39
	 */
	serverDataFolderName?: unknown;
}

interface RemoteEditorLogOptions {
	/** The local editor's install root, `vscode.env.appRoot`. */
	readonly appRoot: string;
	/** The active authority, only when it targets the support bundle workspace. */
	readonly remoteAuthority?: string;
	readonly logger: Logger;
}

/** Return known remote server log globs for the target workspace. */
export async function getRemoteEditorLogGlobs({
	appRoot,
	remoteAuthority,
	logger,
}: RemoteEditorLogOptions): Promise<readonly string[]> {
	const serverDataFolderName = await readServerDataFolderName(appRoot, logger);
	const serverDataPath = remoteAuthority
		? await getRemoteServerDataPath({
				remoteAuthority,
				serverDataFolderName,
				logger,
			})
		: undefined;
	if (serverDataPath) {
		return toRemoteLogGlobs(serverDataPath);
	}
	// The agent expands `~/` against the remote home directory and normalizes
	// separators before glob matching, so the posix style is portable here.
	if (serverDataFolderName) {
		return toRemoteLogGlobs({
			value: `~/${serverDataFolderName}`,
			style: "posix",
		});
	}
	return [];
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
		const product = JSON.parse(productJson) as ProductConfiguration;
		return isSafeServerDataFolderName(product.serverDataFolderName)
			? product.serverDataFolderName
			: undefined;
	} catch (error) {
		logger.warn("Could not read the editor's product metadata", error);
		return undefined;
	}
}

/** Return whether the value is a single portable path segment. */
function isSafeServerDataFolderName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value !== "." &&
		value !== ".." &&
		!hasUnsafePathChars(value) &&
		path.posix.basename(value) === value &&
		path.win32.basename(value) === value
	);
}
