import { DEFAULT_OAUTH_SCOPES } from "./constants";

import type { OAuth2TokenResponse } from "coder/site/src/api/typesGenerated";

import type { OAuthTokenData } from "../storage/secretsManager";

/**
 * Fallback expiry time for access tokens when the server omits expires_in.
 * RFC 6749 recommends but doesn't require expires_in and specifies no default.
 */
const ACCESS_TOKEN_DEFAULT_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Converts an object with string properties to URLSearchParams,
 * filtering out undefined values for use with OAuth requests.
 */
export function toUrlSearchParams(obj: object): URLSearchParams {
	const params = Object.fromEntries(
		Object.entries(obj).filter(
			([, value]) => value !== undefined && typeof value === "string",
		),
	) as Record<string, string>;

	return new URLSearchParams(params);
}

/**
 * Whether the granted scopes cover DEFAULT_OAUTH_SCOPES.
 * Supports wildcard scopes like "workspace:*".
 */
export function hasRequiredScopes(grantedScope: string): boolean {
	const grantedScopes = new Set(grantedScope.split(" "));
	if (grantedScopes.has("coder:all")) {
		return true;
	}
	const requiredScopes = DEFAULT_OAUTH_SCOPES.split(" ");

	for (const required of requiredScopes) {
		if (grantedScopes.has(required)) {
			continue;
		}

		// Check wildcard match (e.g., "workspace:*" grants "workspace:read")
		const colonIndex = required.indexOf(":");
		if (colonIndex !== -1) {
			const prefix = required.substring(0, colonIndex);
			const wildcard = `${prefix}:*`;
			if (grantedScopes.has(wildcard)) {
				continue;
			}
		}

		return false;
	}

	return true;
}

/**
 * Build OAuthTokenData from a token response.
 * Prefers the `expiry` timestamp over calculating from `expires_in`.
 */
export function buildOAuthTokenData(
	tokenResponse: OAuth2TokenResponse,
): OAuthTokenData {
	if (tokenResponse.token_type !== "Bearer") {
		throw new Error(
			`Unsupported token type: ${tokenResponse.token_type}. Only Bearer tokens are supported.`,
		);
	}

	return {
		refresh_token: tokenResponse.refresh_token,
		// Servers that ignore scopes return none and grant everything
		scope: tokenResponse.scope || "coder:all",
		expiry_timestamp: getExpiryTimestamp(tokenResponse),
	};
}

function getExpiryTimestamp(response: OAuth2TokenResponse): number {
	if (response.expiry) {
		const expiryTime = new Date(response.expiry).getTime();
		if (Number.isFinite(expiryTime) && expiryTime > Date.now()) {
			return expiryTime;
		}
	}

	if (
		response.expires_in &&
		response.expires_in > 0 &&
		Number.isFinite(response.expires_in)
	) {
		return Date.now() + response.expires_in * 1000;
	}

	// Default if no expiry info is provided.
	return Date.now() + ACCESS_TOKEN_DEFAULT_EXPIRY_MS;
}
