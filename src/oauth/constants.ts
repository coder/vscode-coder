// OAuth 2.1 Grant Types
export const AUTH_GRANT_TYPE = "authorization_code";
export const REFRESH_GRANT_TYPE = "refresh_token";

// Minimal scopes required by the VS Code extension
export const DEFAULT_OAUTH_SCOPES = [
	"workspace:read",
	"workspace:update",
	"workspace:start",
	"workspace:ssh",
	"workspace:application_connect",
	"template:read",
	"user:read_personal",
].join(" ");

// OAuth 2.1 Response Types
export const RESPONSE_TYPE = "code";

// Token Endpoint Authentication Methods
export const TOKEN_ENDPOINT_AUTH_METHOD = "client_secret_post";

// PKCE Code Challenge Methods (OAuth 2.1 requires S256)
export const PKCE_CHALLENGE_METHOD = "S256";
