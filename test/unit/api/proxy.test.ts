import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getProxyForUrl } from "@/api/proxy";

describe("proxy", () => {
	const proxy = "http://proxy.example.com:8080";

	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("getProxyForUrl", () => {
		describe("proxy resolution", () => {
			it("returns httpProxy when provided", () => {
				expect(getProxyForUrl("https://example.com", proxy, null)).toBe(proxy);
			});

			it("falls back to environment variables when httpProxy is null", () => {
				vi.stubEnv("HTTPS_PROXY", "http://env-proxy.example.com:8080");
				expect(getProxyForUrl("https://example.com", null, null)).toBe(
					"http://env-proxy.example.com:8080",
				);
			});

			it("returns empty string when no proxy is configured", () => {
				const proxyEnvVars = [
					"HTTPS_PROXY",
					"https_proxy",
					"HTTP_PROXY",
					"http_proxy",
					"ALL_PROXY",
					"all_proxy",
					"npm_config_https_proxy",
					"npm_config_proxy",
				];
				proxyEnvVars.forEach((v) => vi.stubEnv(v, ""));

				expect(getProxyForUrl("https://example.com", null, null)).toBe("");
			});

			it("returns empty string for invalid URLs", () => {
				expect(getProxyForUrl("invalid", proxy, null)).toBe("");
			});
		});

		describe("noProxy handling", () => {
			interface NoProxyBypassCase {
				name: string;
				noProxy: string;
				url: string;
			}

			it.each<NoProxyBypassCase>([
				{
					name: "exact match",
					noProxy: "internal.example.com",
					url: "https://internal.example.com",
				},
				{
					name: "wildcard",
					noProxy: "*.internal.example.com",
					url: "https://api.internal.example.com",
				},
				{
					name: "suffix",
					noProxy: ".example.com",
					url: "https://api.example.com",
				},
				{
					name: "wildcard *",
					noProxy: "*",
					url: "https://any.domain.com",
				},
				{
					name: "port-specific",
					noProxy: "example.com:8443",
					url: "https://example.com:8443",
				},
			])(
				"bypasses proxy when hostname matches noProxy ($name)",
				({ noProxy, url }) => {
					expect(getProxyForUrl(url, proxy, noProxy)).toBe("");
				},
			);

			it("proxies when hostname does not match noProxy", () => {
				expect(
					getProxyForUrl("https://external.com", proxy, "internal.example.com"),
				).toBe(proxy);
			});

			it("proxies when port does not match noProxy port", () => {
				expect(
					getProxyForUrl("https://example.com:443", proxy, "example.com:8443"),
				).toBe(proxy);
			});

			it("handles multiple entries in noProxy (comma-separated)", () => {
				const noProxy = "localhost,127.0.0.1,.internal.com";

				expect(getProxyForUrl("https://localhost", proxy, noProxy)).toBe("");
				expect(getProxyForUrl("https://127.0.0.1", proxy, noProxy)).toBe("");
				expect(getProxyForUrl("https://api.internal.com", proxy, noProxy)).toBe(
					"",
				);
				expect(getProxyForUrl("https://external.com", proxy, noProxy)).toBe(
					proxy,
				);
			});
		});

		describe("noProxy fallback chain", () => {
			const targetUrl = "https://internal.example.com";
			const targetHost = "internal.example.com";

			interface NoProxyFallbackCase {
				name: string;
				noProxy: string | null;
				noProxyFallback: string;
			}

			it.each<NoProxyFallbackCase>([
				{
					name: "noProxy (coder.proxyBypass)",
					noProxy: targetHost,
					noProxyFallback: "other.example.com",
				},
				{
					name: "noProxyFallback when noProxy is null",
					noProxy: null,
					noProxyFallback: targetHost,
				},
				{
					name: "noProxyFallback when noProxy is empty",
					noProxy: "",
					noProxyFallback: targetHost,
				},
			])("uses $name", ({ noProxy, noProxyFallback }) => {
				expect(getProxyForUrl(targetUrl, proxy, noProxy, noProxyFallback)).toBe(
					"",
				);
			});

			interface EnvVarFallbackCase {
				name: string;
				envVar: string;
			}

			it.each<EnvVarFallbackCase>([
				{ name: "npm_config_no_proxy", envVar: "npm_config_no_proxy" },
				{ name: "NO_PROXY", envVar: "NO_PROXY" },
				{ name: "no_proxy (lowercase)", envVar: "no_proxy" },
			])("falls back to $name env var", ({ envVar }) => {
				// Clear all no_proxy env vars first
				vi.stubEnv("npm_config_no_proxy", "");
				vi.stubEnv("NO_PROXY", "");
				vi.stubEnv("no_proxy", "");

				vi.stubEnv(envVar, targetHost);
				expect(getProxyForUrl(targetUrl, proxy, null, null)).toBe("");
			});

			it("prioritizes noProxy over noProxyFallback over env vars", () => {
				vi.stubEnv("NO_PROXY", "env.example.com");

				// noProxy takes precedence
				expect(
					getProxyForUrl(
						"https://primary.example.com",
						proxy,
						"primary.example.com",
						"fallback.example.com",
					),
				).toBe("");

				// noProxyFallback is used when noProxy is null
				expect(
					getProxyForUrl(
						"https://fallback.example.com",
						proxy,
						null,
						"fallback.example.com",
					),
				).toBe("");

				// env var is used when both are null
				expect(
					getProxyForUrl("https://env.example.com", proxy, null, null),
				).toBe("");
			});
		});

		describe("protocol and port handling", () => {
			interface ProtocolCase {
				protocol: string;
				url: string;
			}

			it.each<ProtocolCase>([
				{ protocol: "http://", url: "http://example.com" },
				{ protocol: "https://", url: "https://example.com" },
				{ protocol: "ws://", url: "ws://example.com" },
				{ protocol: "wss://", url: "wss://example.com" },
			])("handles $protocol URLs", ({ url }) => {
				expect(getProxyForUrl(url, proxy, null)).toBe(proxy);
			});

			interface DefaultPortCase {
				protocol: string;
				url: string;
				defaultPort: number;
			}

			it.each<DefaultPortCase>([
				{ protocol: "HTTP", url: "http://example.com", defaultPort: 80 },
				{ protocol: "HTTPS", url: "https://example.com", defaultPort: 443 },
				{ protocol: "WS", url: "ws://example.com", defaultPort: 80 },
				{ protocol: "WSS", url: "wss://example.com", defaultPort: 443 },
			])(
				"uses default port $defaultPort for $protocol",
				({ url, defaultPort }) => {
					expect(getProxyForUrl(url, proxy, `example.com:${defaultPort}`)).toBe(
						"",
					);
				},
			);
		});

		describe("proxy scheme handling", () => {
			it("adds scheme to proxy URL when missing", () => {
				expect(
					getProxyForUrl("https://example.com", "proxy.example.com:8080", null),
				).toBe("https://proxy.example.com:8080");
			});

			it("uses request scheme when proxy has no scheme", () => {
				expect(
					getProxyForUrl("http://example.com", "proxy.example.com:8080", null),
				).toBe("http://proxy.example.com:8080");
			});

			it("preserves existing scheme in proxy URL", () => {
				expect(
					getProxyForUrl(
						"https://example.com",
						"http://proxy.example.com:8080",
						null,
					),
				).toBe("http://proxy.example.com:8080");
			});
		});
	});
});
