import { describe, expect, it } from "vitest";

import { buildOAuthTokenData } from "@/oauth/utils";

import type { OAuth2TokenResponse } from "coder/site/src/api/typesGenerated";

const ACCESS_TOKEN_DEFAULT_EXPIRY_MS = 60 * 60 * 1000;

function createTokenResponse(
	overrides: Partial<OAuth2TokenResponse> = {},
): OAuth2TokenResponse {
	return {
		access_token: "test-token",
		token_type: "Bearer",
		expires_in: 3600,
		refresh_token: "refresh-token",
		scope: "workspace:read",
		...overrides,
	};
}

describe("buildOAuthTokenData", () => {
	describe("expires_in validation", () => {
		it("uses expires_in when valid", () => {
			const result = buildOAuthTokenData(
				createTokenResponse({ expires_in: 7200 }),
			);
			const expectedExpiry = Date.now() + 7200 * 1000;
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				expectedExpiry - 100,
			);
			expect(result.expiry_timestamp).toBeLessThanOrEqual(expectedExpiry + 100);
		});

		it("uses default when expires_in is zero", () => {
			const before = Date.now();
			const result = buildOAuthTokenData(
				createTokenResponse({ expires_in: 0 }),
			);
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				before + ACCESS_TOKEN_DEFAULT_EXPIRY_MS,
			);
		});

		it("uses default when expires_in is negative", () => {
			const before = Date.now();
			const result = buildOAuthTokenData(
				createTokenResponse({ expires_in: -100 }),
			);
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				before + ACCESS_TOKEN_DEFAULT_EXPIRY_MS,
			);
		});

		it("uses default when expires_in is undefined", () => {
			const before = Date.now();
			const result = buildOAuthTokenData(
				createTokenResponse({ expires_in: undefined }),
			);
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				before + ACCESS_TOKEN_DEFAULT_EXPIRY_MS,
			);
		});

		it("uses default when expires_in is Infinity", () => {
			const before = Date.now();
			const result = buildOAuthTokenData(
				createTokenResponse({ expires_in: Infinity }),
			);
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				before + ACCESS_TOKEN_DEFAULT_EXPIRY_MS,
			);
		});
	});

	describe("expiry preference over expires_in", () => {
		it("prefers expiry when valid and in the future", () => {
			const futureExpiry = new Date(Date.now() + 2 * 60 * 60 * 1000);
			const result = buildOAuthTokenData(
				createTokenResponse({
					expires_in: 3600,
					expiry: futureExpiry.toISOString(),
				}),
			);
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				futureExpiry.getTime() - 100,
			);
			expect(result.expiry_timestamp).toBeLessThanOrEqual(
				futureExpiry.getTime() + 100,
			);
		});

		it("falls back to expires_in when expiry is in the past", () => {
			const pastExpiry = new Date(Date.now() - 60 * 1000);
			const result = buildOAuthTokenData(
				createTokenResponse({
					expires_in: 3600,
					expiry: pastExpiry.toISOString(),
				}),
			);
			const expectedExpiry = Date.now() + 3600 * 1000;
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				expectedExpiry - 100,
			);
			expect(result.expiry_timestamp).toBeLessThanOrEqual(expectedExpiry + 100);
		});

		it("falls back to expires_in when expiry is invalid", () => {
			const result = buildOAuthTokenData(
				createTokenResponse({
					expires_in: 3600,
					expiry: "not-a-valid-date",
				}),
			);
			const expectedExpiry = Date.now() + 3600 * 1000;
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				expectedExpiry - 100,
			);
			expect(result.expiry_timestamp).toBeLessThanOrEqual(expectedExpiry + 100);
		});

		it("falls back to default when expiry is invalid and expires_in is missing", () => {
			const before = Date.now();
			const result = buildOAuthTokenData(
				createTokenResponse({
					expires_in: undefined,
					expiry: "not-a-valid-date",
				}),
			);
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				before + ACCESS_TOKEN_DEFAULT_EXPIRY_MS,
			);
		});

		it("uses expires_in when expiry is undefined", () => {
			const result = buildOAuthTokenData(
				createTokenResponse({
					expires_in: 7200,
					expiry: undefined,
				}),
			);
			const expectedExpiry = Date.now() + 7200 * 1000;
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				expectedExpiry - 100,
			);
			expect(result.expiry_timestamp).toBeLessThanOrEqual(expectedExpiry + 100);
		});
	});

	describe("token_type validation", () => {
		it("accepts Bearer tokens", () => {
			expect(() =>
				buildOAuthTokenData(createTokenResponse({ token_type: "Bearer" })),
			).not.toThrow();
		});

		it.each(["DPoP", "unknown", "bearer", "BEARER"])(
			"rejects non-Bearer token type: %s",
			(tokenType) => {
				expect(() =>
					buildOAuthTokenData(
						createTokenResponse({ token_type: tokenType as "Bearer" }),
					),
				).toThrow(`Unsupported token type: ${tokenType}`);
			},
		);
	});
});
