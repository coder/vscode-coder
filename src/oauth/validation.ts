import { z } from "zod";

import { parseApiResponse } from "../api/responseValidation";

/**
 * Schemas for the OAuth endpoints hit directly via axios during login,
 * before any session exists. Only the fields the flow reads are required.
 */
export const OAuth2AuthorizationServerMetadataSchema = z.looseObject({
	issuer: z.string().min(1),
	authorization_endpoint: z.string().min(1),
	token_endpoint: z.string().min(1),
	registration_endpoint: z.string().optional(),
	revocation_endpoint: z.string().optional(),
	grant_types_supported: z.array(z.string()).optional(),
	response_types_supported: z.array(z.string()).optional(),
	token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
	code_challenge_methods_supported: z.array(z.string()).optional(),
	scopes_supported: z.array(z.string()).optional(),
});

/**
 * parseApiResponse for OAuth endpoints, which are absolute URLs from
 * server metadata and may live on a different origin than the deployment.
 */
export function parseOAuthResponse<T>(
	schema: z.ZodType<unknown>,
	data: T,
	endpoint: string,
): T {
	const { origin, pathname } = new URL(endpoint);
	return parseApiResponse(schema, data, pathname, origin);
}

export const OAuth2ClientRegistrationResponseSchema = z.looseObject({
	client_id: z.string(),
	client_secret: z.string().optional(),
	redirect_uris: z.array(z.string()).optional(),
});

export const OAuth2TokenResponseSchema = z.looseObject({
	access_token: z.string(),
	token_type: z.string(),
	refresh_token: z.string().optional(),
	expires_in: z.number().optional(),
});
