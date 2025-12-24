import { describe, expect, it } from "vitest";

import { buildOAuthTokenData } from "@/oauth/utils";

import type { TokenResponse } from "@/oauth/types";

const ACCESS_TOKEN_DEFAULT_EXPIRY_MS = 60 * 60 * 1000;

function createTokenResponse(
	overrides: Partial<TokenResponse> = {},
): TokenResponse {
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

	describe("token_type validation", () => {
		it("accepts Bearer tokens", () => {
			const result = buildOAuthTokenData(
				createTokenResponse({ token_type: "Bearer" }),
			);
			expect(result.token_type).toBe("Bearer");
		});

		it("rejects DPoP tokens", () => {
			expect(() =>
				buildOAuthTokenData(
					createTokenResponse({ token_type: "DPoP" as "Bearer" }),
				),
			).toThrow("Unsupported token type: DPoP");
		});

		it("rejects unknown token types", () => {
			expect(() =>
				buildOAuthTokenData(
					createTokenResponse({ token_type: "unknown" as "Bearer" }),
				),
			).toThrow("Unsupported token type: unknown");
		});
	});
});
