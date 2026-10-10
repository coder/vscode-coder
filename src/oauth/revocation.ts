import { withOAuthMetadata } from "./metadataClient";
import { toUrlSearchParams } from "./tokens";

import type {
	OAuth2ClientRegistrationResponse,
	OAuth2TokenRevocationRequest,
} from "coder/site/src/api/typesGenerated";

import type { Logger } from "../logging/logger";
import type { SessionAuth } from "../storage/secretsManager";

/** Best-effort revocation of a captured OAuth session; never reads replacement credentials. */
export async function revokeOAuthTokens(
	auth: SessionAuth,
	registration: OAuth2ClientRegistrationResponse | undefined,
	logger: Logger,
): Promise<void> {
	if (!auth.oauth || !registration) {
		return;
	}
	// Refresh token first, while the access token still authenticates the call.
	const targets: Array<[string, "access_token" | "refresh_token"]> = [];
	if (auth.oauth.refresh_token) {
		targets.push([auth.oauth.refresh_token, "refresh_token"]);
	}
	targets.push([auth.token, "access_token"]);

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
					const params: OAuth2TokenRevocationRequest = {
						token,
						client_id: registration.client_id,
						client_secret: registration.client_secret,
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
