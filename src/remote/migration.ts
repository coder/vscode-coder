import * as fs from "node:fs/promises";

import type { PathResolver } from "../core/pathResolver";
import type { SecretsManager } from "../core/secretsManager";
import type { Logger } from "../logging/logger";

type SessionAuthStore = Pick<
	SecretsManager,
	"getSessionAuth" | "setSessionAuth"
>;

/**
 * Migrate legacy file-based auth to secrets storage: rename the old
 * "session_token" file to "session", then move the url/session file
 * contents into secret storage.
 */
export async function migrateAuthToSecretsStorage(
	safeHostname: string,
	pathResolver: PathResolver,
	secretsManager: SessionAuthStore,
	logger: Logger,
): Promise<void> {
	await migrateSessionTokenFile(safeHostname, pathResolver);
	await migrateSessionAuthFromFiles(
		safeHostname,
		pathResolver,
		secretsManager,
		logger,
	);
}

/**
 * Migrate the session token file from "session_token" to "session".
 */
async function migrateSessionTokenFile(
	safeHostname: string,
	pathResolver: PathResolver,
): Promise<void> {
	const oldTokenPath = pathResolver.getLegacySessionTokenPath(safeHostname);
	const newTokenPath = pathResolver.getSessionTokenPath(safeHostname);
	try {
		await fs.rename(oldTokenPath, newTokenPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
			throw error;
		}
	}
}

/**
 * Migrate URL and session token from files to the multi-deployment secrets
 * storage.
 */
async function migrateSessionAuthFromFiles(
	safeHostname: string,
	pathResolver: PathResolver,
	secretsManager: SessionAuthStore,
	logger: Logger,
): Promise<void> {
	const existingAuth = await secretsManager.getSessionAuth(safeHostname);
	if (existingAuth) {
		return;
	}

	const urlPath = pathResolver.getUrlPath(safeHostname);
	const tokenPath = pathResolver.getSessionTokenPath(safeHostname);
	const [url, token] = await Promise.allSettled([
		fs.readFile(urlPath, "utf8"),
		fs.readFile(tokenPath, "utf8"),
	]);

	if (url.status === "fulfilled" && token.status === "fulfilled") {
		logger.info("Migrating session auth from files for", safeHostname);
		try {
			await secretsManager.setSessionAuth(safeHostname, {
				url: url.value.trim(),
				token: token.value.trim(),
			});
		} catch (error) {
			logger.warn("Failed to migrate session auth from files:", error);
		}
		// Drop the plaintext copies even on failure: a rejected pair names
		// another deployment, and connect rewrites the CLI credentials in its
		// cli_configure phase right after this migration runs.
		await Promise.all(
			[urlPath, tokenPath].map((filePath) =>
				fs.rm(filePath, { force: true }).catch((error) => {
					logger.warn("Failed to remove migrated auth file", filePath, error);
				}),
			),
		);
	}
}
