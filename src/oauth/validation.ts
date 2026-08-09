import { z } from "zod";

/**
 * Permissive schemas for the OAuth endpoints hit directly via axios during
 * login, before any session exists. Only the fields the flow reads are
 * required; unknown fields pass through so newer deployments never break.
 */
export const OAuth2AuthorizationServerMetadataSchema = z.looseObject({
	issuer: z.string(),
	authorization_endpoint: z.string(),
	token_endpoint: z.string(),
	registration_endpoint: z.string().optional(),
	revocation_endpoint: z.string().optional(),
});

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
