import { createHash, randomBytes } from "node:crypto";

import type { OAuth2TokenResponse } from "coder/site/src/api/typesGenerated";

import type { OAuthTokenData } from "../core/secretsManager";

/**
 * OAuth callback path for handling authorization responses (RFC 6749).
 */
export const CALLBACK_PATH = "/oauth/callback";

/**
 * Fallback expiry time for access tokens when the server omits expires_in.
 * RFC 6749 recommends but doesn't require expires_in and specifies no default.
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
		scope: tokenResponse.scope,
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
