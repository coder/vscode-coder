import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getProxyForUrl } from "./proxy";

describe("proxy", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		// Save original environment
		originalEnv = { ...process.env };
		// Clear relevant proxy environment variables
		delete process.env.http_proxy;
		delete process.env.HTTP_PROXY;
		delete process.env.https_proxy;
		delete process.env.HTTPS_PROXY;
		delete process.env.ftp_proxy;
		delete process.env.FTP_PROXY;
		delete process.env.all_proxy;
		delete process.env.ALL_PROXY;
		delete process.env.no_proxy;
		delete process.env.NO_PROXY;
		delete process.env.npm_config_proxy;
		delete process.env.npm_config_http_proxy;
		delete process.env.npm_config_https_proxy;
		delete process.env.npm_config_no_proxy;
	});

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv;
	});

	describe("getProxyForUrl", () => {
		describe("basic proxy resolution", () => {
			it("should return proxy when httpProxy parameter is provided", () => {
				const result = getProxyForUrl(
					"http://example.com",
					"http://proxy.example.com:8080",
					undefined,
				);
				expect(result).toBe("http://proxy.example.com:8080");
			});

			it("should return empty string when no proxy is configured", () => {
				const result = getProxyForUrl(
					"http://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("");
			});

			it("should use environment variable when httpProxy parameter is not provided", () => {
				process.env.http_proxy = "http://env-proxy.example.com:8080";

				const result = getProxyForUrl(
					"http://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("http://env-proxy.example.com:8080");
			});

			it("should prefer httpProxy parameter over environment variables", () => {
				process.env.http_proxy = "http://env-proxy.example.com:8080";

				const result = getProxyForUrl(
					"http://example.com",
					"http://param-proxy.example.com:8080",
					undefined,
				);
				expect(result).toBe("http://param-proxy.example.com:8080");
			});
		});

		describe("protocol-specific proxy resolution", () => {
			it("should use http_proxy for HTTP URLs", () => {
				process.env.http_proxy = "http://http-proxy.example.com:8080";
				process.env.https_proxy = "http://https-proxy.example.com:8080";

				const result = getProxyForUrl(
					"http://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("http://http-proxy.example.com:8080");
			});

			it("should use https_proxy for HTTPS URLs", () => {
				process.env.http_proxy = "http://http-proxy.example.com:8080";
				process.env.https_proxy = "http://https-proxy.example.com:8080";

				const result = getProxyForUrl(
					"https://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("http://https-proxy.example.com:8080");
			});

			it("should use ftp_proxy for FTP URLs", () => {
				process.env.ftp_proxy = "http://ftp-proxy.example.com:8080";

				const result = getProxyForUrl(
					"ftp://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("http://ftp-proxy.example.com:8080");
			});

			it("should fall back to all_proxy when protocol-specific proxy is not set", () => {
				process.env.all_proxy = "http://all-proxy.example.com:8080";

				const result = getProxyForUrl(
					"http://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("http://all-proxy.example.com:8080");
			});
		});

		describe("npm config proxy resolution", () => {
			it("should use npm_config_http_proxy", () => {
				process.env.npm_config_http_proxy =
					"http://npm-http-proxy.example.com:8080";

				const result = getProxyForUrl(
					"http://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("http://npm-http-proxy.example.com:8080");
			});

			it("should use npm_config_proxy as fallback", () => {
				process.env.npm_config_proxy = "http://npm-proxy.example.com:8080";

				const result = getProxyForUrl(
					"http://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("http://npm-proxy.example.com:8080");
			});

			it("should prefer protocol-specific over npm_config_proxy", () => {
				process.env.http_proxy = "http://http-proxy.example.com:8080";
				process.env.npm_config_proxy = "http://npm-proxy.example.com:8080";

				const result = getProxyForUrl(
					"http://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("http://http-proxy.example.com:8080");
			});
		});

		describe("proxy URL normalization", () => {
			it("should add protocol scheme when missing", () => {
				const result = getProxyForUrl(
					"http://example.com",
					"proxy.example.com:8080",
					undefined,
				);
				expect(result).toBe("http://proxy.example.com:8080");
			});

			it("should not modify proxy URL when scheme is present", () => {
				const result = getProxyForUrl(
					"http://example.com",
					"https://proxy.example.com:8080",
					undefined,
				);
				expect(result).toBe("https://proxy.example.com:8080");
			});

			it("should use target URL protocol for missing scheme", () => {
				const result = getProxyForUrl(
					"https://example.com",
					"proxy.example.com:8080",
					undefined,
				);
				expect(result).toBe("https://proxy.example.com:8080");
			});
		});

		describe("NO_PROXY handling", () => {
			it("should not proxy when host is in noProxy parameter", () => {
				const result = getProxyForUrl(
					"http://example.com",
					"http://proxy.example.com:8080",
					"example.com",
				);
				expect(result).toBe("");
			});

			it("should not proxy when host is in NO_PROXY environment variable", () => {
				process.env.NO_PROXY = "example.com";

				const result = getProxyForUrl(
					"http://example.com",
					"http://proxy.example.com:8080",
					undefined,
				);
				expect(result).toBe("");
			});

			it("should prefer noProxy parameter over NO_PROXY environment", () => {
				process.env.NO_PROXY = "other.com";

				const result = getProxyForUrl(
					"http://example.com",
					"http://proxy.example.com:8080",
					"example.com",
				);
				expect(result).toBe("");
			});

			it("should handle wildcard NO_PROXY", () => {
				const result = getProxyForUrl(
					"http://example.com",
					"http://proxy.example.com:8080",
					"*",
				);
				expect(result).toBe("");
			});

			it("should handle comma-separated NO_PROXY list", () => {
				const result = getProxyForUrl(
					"http://example.com",
					"http://proxy.example.com:8080",
					"other.com,example.com,another.com",
				);
				expect(result).toBe("");
			});

			it("should handle space-separated NO_PROXY list", () => {
				const result = getProxyForUrl(
					"http://example.com",
					"http://proxy.example.com:8080",
					"other.com example.com another.com",
				);
				expect(result).toBe("");
			});

			it("should handle wildcard subdomain matching", () => {
				const result = getProxyForUrl(
					"http://sub.example.com",
					"http://proxy.example.com:8080",
					"*.example.com",
				);
				expect(result).toBe("");
			});

			it("should handle domain suffix matching", () => {
				const result = getProxyForUrl(
					"http://sub.example.com",
					"http://proxy.example.com:8080",
					".example.com",
				);
				expect(result).toBe("");
			});

			it("should match port-specific NO_PROXY rules", () => {
				const result = getProxyForUrl(
					"http://example.com:8080",
					"http://proxy.example.com:8080",
					"example.com:8080",
				);
				expect(result).toBe("");
			});

			it("should not match when ports differ in NO_PROXY rule", () => {
				const result = getProxyForUrl(
					"http://example.com:8080",
					"http://proxy.example.com:8080",
					"example.com:9090",
				);
				expect(result).toBe("http://proxy.example.com:8080");
			});

			it("should handle case-insensitive NO_PROXY matching", () => {
				const result = getProxyForUrl(
					"http://EXAMPLE.COM",
					"http://proxy.example.com:8080",
					"example.com",
				);
				expect(result).toBe("");
			});
		});

		describe("default ports", () => {
			it("should use default HTTP port 80", () => {
				const result = getProxyForUrl(
					"http://example.com",
					"http://proxy.example.com:8080",
					"example.com:80",
				);
				expect(result).toBe("");
			});

			it("should use default HTTPS port 443", () => {
				const result = getProxyForUrl(
					"https://example.com",
					"http://proxy.example.com:8080",
					"example.com:443",
				);
				expect(result).toBe("");
			});

			it("should use default FTP port 21", () => {
				const result = getProxyForUrl(
					"ftp://example.com",
					"http://proxy.example.com:8080",
					"example.com:21",
				);
				expect(result).toBe("");
			});

			it("should use default WebSocket port 80", () => {
				const result = getProxyForUrl(
					"ws://example.com",
					"http://proxy.example.com:8080",
					"example.com:80",
				);
				expect(result).toBe("");
			});

			it("should use default secure WebSocket port 443", () => {
				const result = getProxyForUrl(
					"wss://example.com",
					"http://proxy.example.com:8080",
					"example.com:443",
				);
				expect(result).toBe("");
			});
		});

		describe("edge cases", () => {
			it("should return empty string for URLs without protocol", () => {
				const result = getProxyForUrl(
					"example.com",
					"http://proxy.example.com:8080",
					undefined,
				);
				expect(result).toBe("");
			});

			it("should return empty string for URLs without hostname", () => {
				const result = getProxyForUrl(
					"http://",
					"http://proxy.example.com:8080",
					undefined,
				);
				expect(result).toBe("");
			});

			it("should handle IPv6 addresses", () => {
				const result = getProxyForUrl(
					"http://[2001:db8::1]:8080",
					"http://proxy.example.com:8080",
					undefined,
				);
				expect(result).toBe("http://proxy.example.com:8080");
			});

			it("should handle IPv6 addresses in NO_PROXY", () => {
				const result = getProxyForUrl(
					"http://[2001:db8::1]:8080",
					"http://proxy.example.com:8080",
					"[2001:db8::1]:8080",
				);
				expect(result).toBe("");
			});

			it("should handle empty NO_PROXY entries", () => {
				const result = getProxyForUrl(
					"http://example.com",
					"http://proxy.example.com:8080",
					",, example.com ,,",
				);
				expect(result).toBe("");
			});

			it("should handle null proxy configuration", () => {
				const result = getProxyForUrl("http://example.com", null, null);
				expect(result).toBe("");
			});

			it("should be case-insensitive for environment variable names", () => {
				process.env.HTTP_PROXY = "http://upper-proxy.example.com:8080";
				process.env.http_proxy = "http://lower-proxy.example.com:8080";

				// Should prefer lowercase
				const result = getProxyForUrl(
					"http://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("http://lower-proxy.example.com:8080");
			});

			it("should fall back to uppercase environment variables", () => {
				process.env.HTTP_PROXY = "http://upper-proxy.example.com:8080";
				// Don't set lowercase version

				const result = getProxyForUrl(
					"http://example.com",
					undefined,
					undefined,
				);
				expect(result).toBe("http://upper-proxy.example.com:8080");
			});
		});
	});
});
