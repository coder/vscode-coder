import { createHash, randomBytes } from "node:crypto";

import type { OAuthTokenData } from "../core/secretsManager";

import type { TokenResponse } from "./types";

/**
 * OAuth callback path for handling authorization responses (RFC 6749).
 */
export const CALLBACK_PATH = "/oauth/callback";

/**
 * Default expiry time for OAuth access tokens when the server doesn't provide one.
 */
const ACCESS_TOKEN_DEFAULT_EXPIRY_MS = 60 * 60 * 1000;

export interface PKCEChallenge {
	verifier: string;
	challenge: string;
}

/**
 * Generates a PKCE challenge pair (RFC 7636).
 * Creates a code verifier and its SHA256 challenge for secure OAuth flows.
 */
export function generatePKCE(): PKCEChallenge {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

/**
 * Generates a cryptographically secure state parameter to prevent CSRF attacks (RFC 6749).
 */
export function generateState(): string {
	return randomBytes(16).toString("base64url");
}

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
 * Build OAuthTokenData from a token response.
 * Used by LoginCoordinator (initial login) and OAuthSessionManager (refresh).
 */
export function buildOAuthTokenData(
	tokenResponse: TokenResponse,
): OAuthTokenData {
	const expiryTimestamp = tokenResponse.expires_in
		? Date.now() + tokenResponse.expires_in * 1000
		: Date.now() + ACCESS_TOKEN_DEFAULT_EXPIRY_MS;

	return {
		token_type: tokenResponse.token_type,
		refresh_token: tokenResponse.refresh_token,
		scope: tokenResponse.scope,
		expiry_timestamp: expiryTimestamp,
	};
}
