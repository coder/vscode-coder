import { withOAuthMetadata } from "./metadataClient";
import { type OAuthClient, toUrlSearchParams } from "./tokens";

import type { OAuth2TokenRevocationRequest } from "coder/site/src/api/typesGenerated";

import type { Logger } from "../logging/logger";
import type { SessionAuth } from "../storage/secretsManager";

/**
 * Best-effort revocation of the token pair in `auth`; never throws. Signs in as
 * the client that issued the tokens, else `fallbackClient`.
 */
export async function revokeOAuthTokens(
	auth: SessionAuth,
	fallbackClient: OAuthClient | undefined,
	logger: Logger,
): Promise<void> {
	if (!auth.oauth) {
		return;
	}
	const client = auth.oauth.client ?? fallbackClient;
	if (!client) {
		logger.warn("Skipped token revocation: no client registration");
		return;
	}
	// Refresh token first, while the access token still authenticates the call.
	const targets = [
		[auth.oauth.refresh_token, "refresh_token"],
		[auth.token, "access_token"],
	] as const;

	try {
		await withOAuthMetadata(
			auth.url,
			auth.token,
			logger,
			async ({ axiosInstance, metadata }) => {
				const endpoint = metadata.revocation_endpoint;
				if (!endpoint) {
					logger.debug("No revocation endpoint; skipping revocation");
					return;
				}
				for (const [token, token_type_hint] of targets) {
					if (!token) {
						continue;
					}
					const params: OAuth2TokenRevocationRequest = {
						token,
						client_id: client.client_id,
						client_secret: client.client_secret,
						token_type_hint,
					};
					try {
						await axiosInstance.post(endpoint, toUrlSearchParams(params), {
							headers: { "Content-Type": "application/x-www-form-urlencoded" },
						});
						logger.debug(`Revoked ${token_type_hint}`);
					} catch (error) {
						logger.warn(`Failed to revoke ${token_type_hint}:`, error);
					}
				}
			},
		);
	} catch (error) {
		logger.warn("Token revocation failed:", error);
	}
}
