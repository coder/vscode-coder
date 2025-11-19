import { isAxiosError } from "axios";

import type { OAuthErrorResponse } from "./types";

/**
 * Base class for OAuth errors
 */
export class OAuthError extends Error {
	constructor(
		message: string,
		public readonly errorCode: string,
		public readonly description?: string,
		public readonly errorUri?: string,
	) {
		super(message);
		this.name = "OAuthError";
	}
}

/**
 * Refresh token is invalid, expired, or revoked. Requires re-authentication.
 */
export class InvalidGrantError extends OAuthError {
	constructor(description?: string, errorUri?: string) {
		super(
			"OAuth refresh token is invalid, expired, or revoked",
			"invalid_grant",
			description,
			errorUri,
		);
		this.name = "InvalidGrantError";
	}
}

/**
 * Client credentials are invalid. Requires re-registration.
 */
export class InvalidClientError extends OAuthError {
	constructor(description?: string, errorUri?: string) {
		super(
			"OAuth client credentials are invalid",
			"invalid_client",
			description,
			errorUri,
		);
		this.name = "InvalidClientError";
	}
}

/**
 * Invalid request error - malformed OAuth request
 */
export class InvalidRequestError extends OAuthError {
	constructor(description?: string, errorUri?: string) {
		super(
			"OAuth request is malformed or invalid",
			"invalid_request",
			description,
			errorUri,
		);
		this.name = "InvalidRequestError";
	}
}

/**
 * Client is not authorized for this grant type.
 */
export class UnauthorizedClientError extends OAuthError {
	constructor(description?: string, errorUri?: string) {
		super(
			"OAuth client is not authorized for this grant type",
			"unauthorized_client",
			description,
			errorUri,
		);
		this.name = "UnauthorizedClientError";
	}
}

/**
 * Unsupported grant type error.
 */
export class UnsupportedGrantTypeError extends OAuthError {
	constructor(description?: string, errorUri?: string) {
		super(
			"OAuth grant type is not supported",
			"unsupported_grant_type",
			description,
			errorUri,
		);
		this.name = "UnsupportedGrantTypeError";
	}
}

/**
 * Invalid scope error.
 */
export class InvalidScopeError extends OAuthError {
	constructor(description?: string, errorUri?: string) {
		super(
			"OAuth scope is invalid, unknown, malformed, or exceeds the scope granted by the resource owner",
			"invalid_scope",
			description,
			errorUri,
		);
		this.name = "InvalidScopeError";
	}
}

/**
 * Parses an axios error to extract OAuth error information
 * Returns an OAuthError instance if the error is OAuth-related, otherwise returns null
 */
export function parseOAuthError(error: unknown): OAuthError | null {
	if (!isAxiosError(error)) {
		return null;
	}

	const data = error.response?.data;

	if (!isOAuthErrorResponse(data)) {
		return null;
	}

	const { error: errorCode, error_description, error_uri } = data;

	switch (errorCode) {
		case "invalid_grant":
			return new InvalidGrantError(error_description, error_uri);
		case "invalid_client":
			return new InvalidClientError(error_description, error_uri);
		case "invalid_request":
			return new InvalidRequestError(error_description, error_uri);
		case "unauthorized_client":
			return new UnauthorizedClientError(error_description, error_uri);
		case "unsupported_grant_type":
			return new UnsupportedGrantTypeError(error_description, error_uri);
		case "invalid_scope":
			return new InvalidScopeError(error_description, error_uri);
		default:
			return new OAuthError(
				`OAuth error: ${errorCode}`,
				errorCode,
				error_description,
				error_uri,
			);
	}
}

function isOAuthErrorResponse(data: unknown): data is OAuthErrorResponse {
	return (
		data !== null &&
		typeof data === "object" &&
		"error" in data &&
		typeof data.error === "string"
	);
}

/**
 * Checks if an error requires re-authentication
 */
export function requiresReAuthentication(error: OAuthError): boolean {
	return (
		error instanceof InvalidGrantError || error instanceof InvalidClientError
	);
}
