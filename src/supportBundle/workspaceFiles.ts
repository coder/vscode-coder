import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
	getRemoteServerDataPath,
	toRemoteLogGlobs,
} from "./remoteServerDataPath";

import type { Logger } from "../logging/logger";

interface ProductConfiguration {
	/**
	 * Name of the server's data directory under the remote user's home
	 * directory, such as `.vscode-server`.
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
	const serverDataPath = await getRemoteServerDataPath({
		remoteAuthority,
		serverDataFolderName,
		logger,
	});
	return toRemoteLogGlobs(serverDataPath);
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
