import { createHash, randomBytes } from "node:crypto";

/**
 * OAuth callback path for handling authorization responses (RFC 6749).
 */
export const CALLBACK_PATH = "/oauth/callback";

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
