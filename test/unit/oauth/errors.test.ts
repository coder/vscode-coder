import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import {
	InvalidClientError,
	InvalidGrantError,
	InvalidRequestError,
	InvalidScopeError,
	OAuthError,
	parseOAuthError,
	requiresReAuthentication,
	UnauthorizedClientError,
	UnsupportedGrantTypeError,
} from "@/oauth/errors";

/**
 * Creates an AxiosError with OAuth error response data for testing.
 */
function createOAuthAxiosError(
	errorCode: string,
	errorDescription?: string,
	errorUri?: string,
): AxiosError {
	const data: Record<string, string> = { error: errorCode };
	if (errorDescription) {
		data.error_description = errorDescription;
	}
	if (errorUri) {
		data.error_uri = errorUri;
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
	describe("known error codes", () => {
		it.each([
			{
				code: "invalid_grant",
				expectedClass: InvalidGrantError,
				expectedName: "InvalidGrantError",
			},
			{
				code: "invalid_client",
				expectedClass: InvalidClientError,
				expectedName: "InvalidClientError",
			},
			{
				code: "invalid_request",
				expectedClass: InvalidRequestError,
				expectedName: "InvalidRequestError",
			},
			{
				code: "unauthorized_client",
				expectedClass: UnauthorizedClientError,
				expectedName: "UnauthorizedClientError",
			},
			{
				code: "unsupported_grant_type",
				expectedClass: UnsupportedGrantTypeError,
				expectedName: "UnsupportedGrantTypeError",
			},
			{
				code: "invalid_scope",
				expectedClass: InvalidScopeError,
				expectedName: "InvalidScopeError",
			},
		])("returns $expectedName for $code", ({ code, expectedClass }) => {
			const axiosError = createOAuthAxiosError(code);
			const result = parseOAuthError(axiosError);

			expect(result).toBeInstanceOf(expectedClass);
			expect(result?.errorCode).toBe(code);
		});
	});

	describe("error codes without specialized classes", () => {
		it.each(["invalid_target", "unsupported_token_type", "server_error"])(
			"falls back to base OAuthError for %s",
			(code) => {
				const result = parseOAuthError(createOAuthAxiosError(code));

				expect(result).toBeInstanceOf(OAuthError);
				expect(result).not.toBeInstanceOf(InvalidGrantError);
				expect(result).not.toBeInstanceOf(InvalidClientError);
				expect(result?.errorCode).toBe(code);
			},
		);
	});

	describe("edge cases", () => {
		it("returns null for non-axios errors", () => {
			const error = new Error("Network failure");
			const result = parseOAuthError(error);

			expect(result).toBeNull();
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
			const result = parseOAuthError(error);

			expect(result).toBeNull();
		});

		it("preserves error_description and error_uri when present", () => {
			const axiosError = createOAuthAxiosError(
				"invalid_grant",
				"The refresh token has expired",
				"https://example.com/oauth/errors#invalid_grant",
			);
			const result = parseOAuthError(axiosError);

			expect(result).toBeInstanceOf(InvalidGrantError);
			expect(result?.description).toBe("The refresh token has expired");
			expect(result?.errorUri).toBe(
				"https://example.com/oauth/errors#invalid_grant",
			);
		});

		it("handles missing error_description and error_uri", () => {
			const axiosError = createOAuthAxiosError("invalid_client");
			const result = parseOAuthError(axiosError);

			expect(result).toBeInstanceOf(InvalidClientError);
			expect(result?.description).toBeUndefined();
			expect(result?.errorUri).toBeUndefined();
		});
	});
});

describe("requiresReAuthentication", () => {
	it("returns true for InvalidGrantError", () => {
		const error = new InvalidGrantError("Token expired");
		expect(requiresReAuthentication(error)).toBe(true);
	});

	it("returns true for InvalidClientError", () => {
		const error = new InvalidClientError("Client credentials invalid");
		expect(requiresReAuthentication(error)).toBe(true);
	});

	it.each([
		{ name: "InvalidRequestError", error: new InvalidRequestError() },
		{ name: "UnauthorizedClientError", error: new UnauthorizedClientError() },
		{
			name: "UnsupportedGrantTypeError",
			error: new UnsupportedGrantTypeError(),
		},
		{ name: "InvalidScopeError", error: new InvalidScopeError() },
		{ name: "generic OAuthError", error: new OAuthError("Error", "unknown") },
	])("returns false for $name", ({ error }) => {
		expect(requiresReAuthentication(error)).toBe(false);
	});
});

describe("OAuthError classes", () => {
	it("sets correct error name for each class", () => {
		expect(new OAuthError("msg", "code").name).toBe("OAuthError");
		expect(new InvalidGrantError().name).toBe("InvalidGrantError");
		expect(new InvalidClientError().name).toBe("InvalidClientError");
		expect(new InvalidRequestError().name).toBe("InvalidRequestError");
		expect(new UnauthorizedClientError().name).toBe("UnauthorizedClientError");
		expect(new UnsupportedGrantTypeError().name).toBe(
			"UnsupportedGrantTypeError",
		);
		expect(new InvalidScopeError().name).toBe("InvalidScopeError");
	});

	it("sets correct error codes", () => {
		expect(new InvalidGrantError().errorCode).toBe("invalid_grant");
		expect(new InvalidClientError().errorCode).toBe("invalid_client");
		expect(new InvalidRequestError().errorCode).toBe("invalid_request");
		expect(new UnauthorizedClientError().errorCode).toBe("unauthorized_client");
		expect(new UnsupportedGrantTypeError().errorCode).toBe(
			"unsupported_grant_type",
		);
		expect(new InvalidScopeError().errorCode).toBe("invalid_scope");
	});
});
