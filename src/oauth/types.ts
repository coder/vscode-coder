// Re-export OAuth types from coder/coder
export type {
	OAuth2AuthorizationServerMetadata,
	OAuth2ClientRegistrationRequest,
	OAuth2ClientRegistrationResponse,
	OAuth2ProviderGrantType,
	OAuth2ProviderResponseType,
} from "coder/site/src/api/typesGenerated";

// Token Endpoint Authentication Methods (not in coder/coder types)
export type TokenEndpointAuthMethod =
	| "client_secret_post"
	| "client_secret_basic"
	| "none";

// PKCE Code Challenge Methods (OAuth 2.1 requires S256)
export type CodeChallengeMethod = "S256";

// Token Types
export type TokenType = "Bearer" | "DPoP";

// Token Response (RFC 6749 Section 5.1) - not in coder/coder types
export interface TokenResponse {
	access_token: string;
	token_type: TokenType;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
}

// Token Request Parameters - Authorization Code Grant (OAuth 2.1)
export interface TokenRequestParams {
	grant_type: "authorization_code";
	code: string;
	redirect_uri: string;
	client_id: string;
	code_verifier: string;
	client_secret?: string;
}

// Token Request Parameters - Refresh Token Grant
export interface RefreshTokenRequestParams {
	grant_type: "refresh_token";
	refresh_token: string;
	client_id: string;
	client_secret?: string;
	scope?: string;
}

// Token Revocation Request (RFC 7009)
export interface TokenRevocationRequest {
	token: string;
	token_type_hint?: "access_token" | "refresh_token";
	client_id: string;
	client_secret?: string;
}

// Error Response (RFC 6749 Section 5.2)
export interface OAuthErrorResponse {
	error:
		| "invalid_request"
		| "invalid_client"
		| "invalid_grant"
		| "unauthorized_client"
		| "unsupported_grant_type"
		| "invalid_scope"
		| "invalid_target"
		| "unsupported_token_type"
		| "server_error"
		| "temporarily_unavailable";
	error_description?: string;
	error_uri?: string;
}
