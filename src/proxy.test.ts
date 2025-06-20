import { describe, it, expect } from "vitest";
import { getProxyForUrl } from "./proxy";

describe("proxy", () => {
	it("should export getProxyForUrl function", () => {
		expect(typeof getProxyForUrl).toBe("function");
	});

	it("should return empty string for invalid URLs", () => {
		const result = getProxyForUrl("", null, null);
		expect(result).toBe("");
	});

	it("should handle basic URL without proxy", () => {
		const result = getProxyForUrl("https://example.com", null, null);
		expect(result).toBe("");
	});
});
