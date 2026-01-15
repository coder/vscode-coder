import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import {
	OAuthError,
	parseOAuthError,
	requiresReAuthentication,
} from "@/oauth/errors";

import type { OAuth2ErrorCode } from "coder/site/src/api/typesGenerated";

function createOAuthAxiosError(
	errorCode: string,
	errorDescription?: string,
): AxiosError {
	const data: Record<string, string> = { error: errorCode };
	if (errorDescription) {
		data.error_description = errorDescription;
	}

	return new AxiosError(
		"OAuth Error",
		"ERR_BAD_REQUEST",
		undefined,
		undefined,
		{
			status: 400,
			statusText: "Bad Request",
			headers: {},
			config: { headers: new AxiosHeaders() },
			data,
		},
	);
}

describe("parseOAuthError", () => {
	it.each<OAuth2ErrorCode>([
		"invalid_grant",
		"invalid_client",
		"invalid_request",
		"unauthorized_client",
		"unsupported_grant_type",
		"invalid_scope",
		"access_denied",
		"invalid_target",
		"server_error",
		"temporarily_unavailable",
		"unsupported_response_type",
		"unsupported_token_type",
	])("parses %s error code", (code) => {
		const result = parseOAuthError(createOAuthAxiosError(code));

		expect(result).toBeInstanceOf(OAuthError);
		expect(result?.errorCode).toBe(code);
	});

	it("returns null for non-axios errors", () => {
		expect(parseOAuthError(new Error("Network failure"))).toBeNull();
	});

	it("returns null for axios errors without OAuth response body", () => {
		const error = new AxiosError(
			"Server Error",
			"ERR_BAD_RESPONSE",
			undefined,
			undefined,
			{
				status: 500,
				statusText: "Internal Server Error",
				headers: {},
				config: { headers: new AxiosHeaders() },
				data: { message: "Something went wrong" },
			},
		);

		expect(parseOAuthError(error)).toBeNull();
	});

	it("returns null for axios errors with null response data", () => {
		const error = new AxiosError(
			"Error",
			"ERR_BAD_REQUEST",
			undefined,
			undefined,
			{
				status: 400,
				statusText: "Bad Request",
				headers: {},
				config: { headers: new AxiosHeaders() },
				data: null,
			},
		);

		expect(parseOAuthError(error)).toBeNull();
	});

	it("uses server description when provided", () => {
		const result = parseOAuthError(
			createOAuthAxiosError("invalid_grant", "The refresh token has expired"),
		);

		expect(result?.message).toBe("The refresh token has expired");
	});

	it("uses default description when server omits it", () => {
		const result = parseOAuthError(createOAuthAxiosError("invalid_client"));

		expect(result?.message).toBe("OAuth client credentials are invalid");
	});
});

describe("requiresReAuthentication", () => {
	it.each<OAuth2ErrorCode>(["invalid_client", "invalid_grant"])(
		"returns true for %s",
		(code) => {
			expect(requiresReAuthentication(new OAuthError(code))).toBe(true);
		},
	);

	it.each<OAuth2ErrorCode>([
		"invalid_request",
		"unauthorized_client",
		"unsupported_grant_type",
		"invalid_scope",
		"access_denied",
		"server_error",
	])("returns false for %s", (code) => {
		expect(requiresReAuthentication(new OAuthError(code))).toBe(false);
	});
});

describe("OAuthError", () => {
	it("uses default description for known error codes", () => {
		const error = new OAuthError("invalid_grant");
		expect(error.message).toBe(
			"OAuth refresh token is invalid, expired, or revoked",
		);
	});

	it("uses provided description over default", () => {
		const error = new OAuthError("invalid_grant", "Token was revoked by user");
		expect(error.message).toBe("Token was revoked by user");
	});

	it("uses fallback description for unknown error codes", () => {
		// Server could return an unknown error code at runtime
		const error = new OAuthError(
			"some_unknown_error" as unknown as OAuth2ErrorCode,
		);
		expect(error.message).toBe("Unknown OAuth error: some_unknown_error");
	});

	it("sets name to OAuthError", () => {
		expect(new OAuthError("invalid_grant").name).toBe("OAuthError");
	});
});
