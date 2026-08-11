import { z } from "zod";

import { parseApiResponse } from "../api/responseValidation";

/**
 * parseApiResponse for OAuth endpoints, whose absolute URLs come from server
 * metadata and may live on a different origin than the deployment. The schemas
 * below follow the same rules.
 */
export function parseOAuthResponse<T>(
	schema: z.ZodType<unknown>,
	data: T,
	endpoint: string,
): T {
	const { origin, pathname } = new URL(endpoint);
	return parseApiResponse(schema, data, pathname, origin);
}

/** An empty endpoint or identifier is as unusable as a missing one. */
const REQUIRED_STRING = z.string().min(1);

/**
 * Plain strings rather than the generated enums, so a server adding a value
 * does not fail validation. Absent means the RFC 8414 default applies.
 */
const CAPABILITIES = z.array(z.string()).optional();

export const OAuth2AuthorizationServerMetadataSchema = z.looseObject({
	issuer: REQUIRED_STRING,
	authorization_endpoint: REQUIRED_STRING,
	token_endpoint: REQUIRED_STRING,
	// Callers report these as unsupported when absent, so no .min(1) here.
	registration_endpoint: z.string().optional(),
	revocation_endpoint: z.string().optional(),
	grant_types_supported: CAPABILITIES,
	response_types_supported: CAPABILITIES,
	token_endpoint_auth_methods_supported: CAPABILITIES,
	code_challenge_methods_supported: CAPABILITIES,
	scopes_supported: CAPABILITIES,
});

export const OAuth2ClientRegistrationResponseSchema = z.looseObject({
	client_id: REQUIRED_STRING,
	client_secret: z.string().optional(),
	redirect_uris: z.array(z.string()).optional(),
});

export const OAuth2TokenResponseSchema = z.looseObject({
	access_token: REQUIRED_STRING,
	token_type: z.string(),
	refresh_token: z.string().optional(),
	expires_in: z.number().optional(),
});
