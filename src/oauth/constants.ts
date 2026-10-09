// OAuth 2.1 Grant Types
export const AUTH_GRANT_TYPE = "authorization_code";
export const REFRESH_GRANT_TYPE = "refresh_token";

/**
 * Scopes the extension and the CLI need. Stored sessions must have all of
 * them, so adding one signs out users of servers that enforce scopes.
 */
export const DEFAULT_OAUTH_SCOPES = [
	"coder:workspaces.operate",
	"coder:workspaces.access",
	"workspace:create",
	"user:read",
	"user:read_personal",
].join(" ");

/**
 * Requested only when the server lists them in `scopes_supported`, as servers
 * reject scopes they don't know. Stored sessions don't need them.
 */
export const IF_SUPPORTED_OAUTH_SCOPES = ["inbox_notification:read"];

// OAuth 2.1 Response Types
export const RESPONSE_TYPE = "code";

// Token Endpoint Authentication Methods
export const TOKEN_ENDPOINT_AUTH_METHOD = "client_secret_post";

// PKCE Code Challenge Methods (OAuth 2.1 requires S256)
export const PKCE_CHALLENGE_METHOD = "S256";

/**
 * OAuth callback path for handling authorization responses (RFC 6749).
 */
export const CALLBACK_PATH = "/oauth/callback";
