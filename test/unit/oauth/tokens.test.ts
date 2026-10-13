import { describe, expect, it } from "vitest";

import { buildOAuthTokenData } from "@/oauth/tokens";

import type { OAuth2TokenResponse } from "coder/site/src/api/typesGenerated";

const ACCESS_TOKEN_DEFAULT_EXPIRY_MS = 60 * 60 * 1000;
const REGISTRATION = { client_id: "client-id", client_secret: "client-secret" };

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
				REGISTRATION,
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
				REGISTRATION,
			);
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				before + ACCESS_TOKEN_DEFAULT_EXPIRY_MS,
			);
		});

		it("uses default when expires_in is negative", () => {
			const before = Date.now();
			const result = buildOAuthTokenData(
				createTokenResponse({ expires_in: -100 }),
				REGISTRATION,
			);
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				before + ACCESS_TOKEN_DEFAULT_EXPIRY_MS,
			);
		});

		it("uses default when expires_in is undefined", () => {
			const before = Date.now();
			const result = buildOAuthTokenData(
				createTokenResponse({ expires_in: undefined }),
				REGISTRATION,
			);
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				before + ACCESS_TOKEN_DEFAULT_EXPIRY_MS,
			);
		});

		it("uses default when expires_in is Infinity", () => {
			const before = Date.now();
			const result = buildOAuthTokenData(
				createTokenResponse({ expires_in: Infinity }),
				REGISTRATION,
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
				REGISTRATION,
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
				REGISTRATION,
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
				REGISTRATION,
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
				REGISTRATION,
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
				REGISTRATION,
			);
			const expectedExpiry = Date.now() + 7200 * 1000;
			expect(result.expiry_timestamp).toBeGreaterThanOrEqual(
				expectedExpiry - 100,
			);
			expect(result.expiry_timestamp).toBeLessThanOrEqual(expectedExpiry + 100);
		});
	});

	it("records the registration the tokens were issued to", () => {
		expect(
			buildOAuthTokenData(createTokenResponse(), REGISTRATION).registration,
		).toEqual(REGISTRATION);
	});

	it("stores coder:all when the server returns no scope", () => {
		expect(
			buildOAuthTokenData(
				createTokenResponse({ scope: undefined }),
				REGISTRATION,
			).scope,
		).toBe("coder:all");
	});

	describe("token_type validation", () => {
		it("accepts Bearer tokens", () => {
			expect(() =>
				buildOAuthTokenData(
					createTokenResponse({ token_type: "Bearer" }),
					REGISTRATION,
				),
			).not.toThrow();
		});

		it.each(["DPoP", "unknown", "bearer", "BEARER"])(
			"rejects non-Bearer token type: %s",
			(tokenType) => {
				expect(() =>
					buildOAuthTokenData(
						createTokenResponse({ token_type: tokenType as "Bearer" }),
						REGISTRATION,
					),
				).toThrow(`Unsupported token type: ${tokenType}`);
			},
		);
	});
});
