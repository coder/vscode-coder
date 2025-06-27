import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { getProxyForUrl } from "./proxy";

describe("proxy", () => {
	beforeEach(() => {
		// Clear environment variables before each test
		vi.stubEnv("http_proxy", "");
		vi.stubEnv("https_proxy", "");
		vi.stubEnv("no_proxy", "");
		vi.stubEnv("all_proxy", "");
		vi.stubEnv("npm_config_proxy", "");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("should return empty string for invalid URLs", () => {
		expect(getProxyForUrl("", null, null)).toBe("");
		expect(getProxyForUrl("invalid-url", null, null)).toBe("");
	});

	it("should handle basic URL without proxy", () => {
		const result = getProxyForUrl("https://example.com", null, null);
		expect(result).toBe("");
	});

	it("should return provided http proxy", () => {
		const result = getProxyForUrl(
			"http://example.com",
			"http://proxy:8080",
			null,
		);
		expect(result).toBe("http://proxy:8080");
	});

	it("should add protocol to proxy URL when missing", () => {
		const result = getProxyForUrl("https://example.com", "proxy:8080", null);
		expect(result).toBe("https://proxy:8080");
	});

	it("should respect no_proxy setting with wildcard", () => {
		const result = getProxyForUrl(
			"https://example.com",
			"http://proxy:8080",
			"*",
		);
		expect(result).toBe("");
	});

	it("should respect no_proxy setting with exact hostname", () => {
		const result = getProxyForUrl(
			"https://example.com",
			"http://proxy:8080",
			"example.com",
		);
		expect(result).toBe("");
	});

	it("should proxy when hostname not in no_proxy", () => {
		const result = getProxyForUrl(
			"https://example.com",
			"http://proxy:8080",
			"other.com",
		);
		expect(result).toBe("http://proxy:8080");
	});

	it("should handle no_proxy with port matching", () => {
		const result = getProxyForUrl(
			"https://example.com:8443",
			"http://proxy:8080",
			"example.com:8443",
		);
		expect(result).toBe("");
	});

	it("should handle multiple no_proxy entries", () => {
		const result = getProxyForUrl(
			"https://example.com",
			"http://proxy:8080",
			"localhost,127.0.0.1,example.com",
		);
		expect(result).toBe("");
	});

	it("should use environment variable proxies when no explicit proxy provided", () => {
		vi.stubEnv("https_proxy", "http://env-proxy:3128");
		const result = getProxyForUrl("https://example.com", null, null);
		expect(result).toBe("http://env-proxy:3128");
	});

	it("should use all_proxy as fallback", () => {
		vi.stubEnv("all_proxy", "http://all-proxy:3128");
		const result = getProxyForUrl("ftp://example.com", null, null);
		expect(result).toBe("http://all-proxy:3128");
	});
});
