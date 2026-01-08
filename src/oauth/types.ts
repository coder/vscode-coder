// OAuth 2.1 Grant Types
export type GrantType =
	| "authorization_code"
	| "refresh_token"
	| "client_credentials";

// OAuth 2.1 Response Types
export type ResponseType = "code";

// Token Endpoint Authentication Methods
export type TokenEndpointAuthMethod =
	| "client_secret_post"
	| "client_secret_basic"
	| "none";

// PKCE Code Challenge Methods (OAuth 2.1 requires S256)
export type CodeChallengeMethod = "S256";

// Token Types
export type TokenType = "Bearer" | "DPoP";

// Client Registration Request (RFC 7591 + OAuth 2.1)
export interface ClientRegistrationRequest {
	redirect_uris: string[];
	token_endpoint_auth_method: TokenEndpointAuthMethod;
	grant_types: GrantType[];
	response_types: ResponseType[];
	client_name?: string;
	client_uri?: string;
	logo_uri?: string;
	scope?: string;
	contacts?: string[];
	tos_uri?: string;
	policy_uri?: string;
	jwks_uri?: string;
	software_id?: string;
	software_version?: string;
}

// Client Registration Response (RFC 7591)
export interface ClientRegistrationResponse {
	client_id: string;
	client_secret?: string;
	client_id_issued_at?: number;
	client_secret_expires_at?: number;
	redirect_uris: string[];
	token_endpoint_auth_method: TokenEndpointAuthMethod;
	grant_types: GrantType[];
	response_types: ResponseType[];
	client_name?: string;
	client_uri?: string;
	logo_uri?: string;
	scope?: string;
	contacts?: string[];
	tos_uri?: string;
	policy_uri?: string;
	jwks_uri?: string;
	software_id?: string;
	software_version?: string;
	registration_client_uri?: string;
	registration_access_token?: string;
}

// OAuth 2.1 Authorization Server Metadata (RFC 8414)
export interface OAuthServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	jwks_uri?: string;
	response_types_supported: ResponseType[];
	grant_types_supported?: GrantType[];
	code_challenge_methods_supported: CodeChallengeMethod[];
	scopes_supported?: string[];
	token_endpoint_auth_methods_supported?: TokenEndpointAuthMethod[];
	revocation_endpoint?: string;
	revocation_endpoint_auth_methods_supported?: TokenEndpointAuthMethod[];
	introspection_endpoint?: string;
	introspection_endpoint_auth_methods_supported?: TokenEndpointAuthMethod[];
	service_documentation?: string;
	ui_locales_supported?: string[];
}

// Token Response (RFC 6749 Section 5.1)
export interface TokenResponse {
	access_token: string;
	token_type: TokenType;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
}

// Authorization Request Parameters (OAuth 2.1)
export interface AuthorizationRequestParams {
	client_id: string;
	response_type: ResponseType;
	redirect_uri: string;
	scope?: string;
	state: string;
	code_challenge: string;
	code_challenge_method: CodeChallengeMethod;
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

// Token Request Parameters - Client Credentials Grant
export interface ClientCredentialsRequestParams {
	grant_type: "client_credentials";
	client_id: string;
	client_secret: string;
	scope?: string;
}

// Union type for all token request types
export type TokenRequestParamsUnion =
	| TokenRequestParams
	| RefreshTokenRequestParams
	| ClientCredentialsRequestParams;

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
		| "server_error"
		| "temporarily_unavailable";
	error_description?: string;
	error_uri?: string;
}
