import { describe, expect, it } from "vitest";
import { maskSensitiveData, truncateLargeData } from "./masking";

describe("masking", () => {
	describe("maskSensitiveData", () => {
		it("should mask SSH private keys", () => {
			const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1234567890abcdef
-----END RSA PRIVATE KEY-----`;
			expect(maskSensitiveData(input)).toBe("[REDACTED KEY]");
		});

		it("should mask passwords in URLs", () => {
			const input = "https://user:mypassword@example.com/path";
			expect(maskSensitiveData(input)).toBe(
				"https://user:[REDACTED]@example.com/path",
			);
		});

		it("should mask AWS access keys", () => {
			const input = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
			expect(maskSensitiveData(input)).toBe(
				"AWS_ACCESS_KEY_ID=[REDACTED AWS KEY]",
			);
		});

		it("should mask bearer tokens", () => {
			const input = "Authorization: Bearer abc123def456";
			expect(maskSensitiveData(input)).toBe("Authorization: Bearer [REDACTED]");
		});

		it("should mask password patterns", () => {
			const input1 = "password: mysecret123";
			const input2 = "passwd=anothersecret";
			const input3 = 'pwd: "yetanothersecret"';

			expect(maskSensitiveData(input1)).toBe("password: [REDACTED]");
			expect(maskSensitiveData(input2)).toBe("passwd: [REDACTED]");
			expect(maskSensitiveData(input3)).toBe("pwd: [REDACTED]");
		});

		it("should mask token patterns", () => {
			const input1 = "token: abc123xyz";
			const input2 = "api_key=secretkey123";

			expect(maskSensitiveData(input1)).toBe("token: [REDACTED]");
			expect(maskSensitiveData(input2)).toBe("api_key: [REDACTED]");
		});

		it("should handle multiple sensitive items", () => {
			const input = `Config:
        url: https://admin:password123@coder.example.com
        token: mysecrettoken
        AWS_KEY: AKIAIOSFODNN7EXAMPLE`;

			const expected = `Config:
        url: https://admin:[REDACTED]@coder.example.com
        token: [REDACTED]
        AWS_KEY: [REDACTED AWS KEY]`;

			expect(maskSensitiveData(input)).toBe(expected);
		});
	});

	describe("truncateLargeData", () => {
		it("should not truncate small data", () => {
			const input = "Small data";
			expect(truncateLargeData(input)).toBe(input);
		});

		it("should truncate large data", () => {
			const input = "x".repeat(11000);
			const result = truncateLargeData(input);
			expect(result.length).toBe(10240 + "[TRUNCATED after 10KB]".length + 1); // +1 for newline
			expect(result).toContain("[TRUNCATED after 10KB]");
		});

		it("should respect custom max length", () => {
			const input = "x".repeat(100);
			const result = truncateLargeData(input, 50);
			expect(result).toBe("x".repeat(50) + "\n[TRUNCATED after 10KB]");
		});
	});
});
