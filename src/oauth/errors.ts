import { isAxiosError } from "axios";

import type {
	OAuth2Error,
	OAuth2ErrorCode,
} from "coder/site/src/api/typesGenerated";

const DEFAULT_DESCRIPTIONS: Record<OAuth2ErrorCode, string> = {
	access_denied: "The resource owner denied the request",
	invalid_client: "OAuth client credentials are invalid",
	invalid_grant: "OAuth refresh token is invalid, expired, or revoked",
	invalid_request: "OAuth request is malformed or invalid",
	invalid_scope:
		"OAuth scope is invalid, unknown, malformed, or exceeds the scope granted by the resource owner",
	invalid_target: "The requested resource is invalid or unknown",
	server_error: "The authorization server encountered an unexpected error",
	temporarily_unavailable:
		"The authorization server is temporarily unavailable",
	unauthorized_client: "OAuth client is not authorized for this grant type",
	unsupported_grant_type: "OAuth grant type is not supported",
	unsupported_response_type: "OAuth response type is not supported",
	unsupported_token_type: "OAuth token type is not supported",
};

export class OAuthError extends Error {
	constructor(
		public readonly errorCode: OAuth2ErrorCode,
		description?: string,
	) {
		super(
			description ??
				DEFAULT_DESCRIPTIONS[errorCode] ??
				`Unknown OAuth error: ${errorCode}`,
		);
		this.name = "OAuthError";
	}
}

export function parseOAuthError(error: unknown): OAuthError | null {
	if (!isAxiosError(error)) {
		return null;
	}

	const data: unknown = error.response?.data;
	if (!isOAuth2Error(data)) {
		return null;
	}

	return new OAuthError(data.error, data.error_description);
}

function isOAuth2Error(data: unknown): data is OAuth2Error {
	return (
		data !== null &&
		typeof data === "object" &&
		"error" in data &&
		typeof data.error === "string"
	);
}

export function requiresReAuthentication(error: OAuthError): boolean {
	return (
		error.errorCode === "invalid_grant" || error.errorCode === "invalid_client"
	);
}
