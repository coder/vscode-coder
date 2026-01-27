import { vol } from "memfs";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createHttpAgent, needToken } from "@/api/utils";

import { MockConfigurationProvider } from "../../mocks/testHelpers";

import type * as http from "node:http";
import type { ConnectionOptions } from "node:tls";
import type { ProxyAgentOptions } from "proxy-agent";

vi.mock("node:fs/promises", async () => {
	const memfs = await import("memfs");
	return { default: memfs.fs.promises, ...memfs.fs.promises };
});

// ProxyAgentOptions extends TLS options but TypeScript doesn't resolve the intersection.
type AgentOpts = ProxyAgentOptions & ConnectionOptions;

describe("needToken", () => {
	interface NeedTokenCase {
		name: string;
		config: Record<string, string>;
		expected: boolean;
	}

	it.each<NeedTokenCase>([
		{ name: "no mTLS certificates", config: {}, expected: true },
		{
			name: "cert file configured",
			config: { "coder.tlsCertFile": "/cert.pem" },
			expected: false,
		},
		{
			name: "key file configured",
			config: { "coder.tlsKeyFile": "/key.pem" },
			expected: false,
		},
		{
			name: "both cert and key configured",
			config: {
				"coder.tlsCertFile": "/cert.pem",
				"coder.tlsKeyFile": "/key.pem",
			},
			expected: false,
		},
	])("returns $expected when $name", ({ config, expected }) => {
		const cfg = new MockConfigurationProvider();
		Object.entries(config).forEach(([k, v]) => cfg.set(k, v));

		expect(needToken(cfg)).toBe(expected);
	});
});

describe("createHttpAgent", () => {
	beforeEach(() => {
		vol.reset();
	});

	describe("TLS certificates", () => {
		it("reads certificate files from disk", async () => {
			vol.fromJSON({
				"/cert.pem": "cert-content",
				"/key.pem": "key-content",
				"/ca.pem": "ca-content",
			});

			const cfg = new MockConfigurationProvider();
			cfg.set("coder.tlsCertFile", "/cert.pem");
			cfg.set("coder.tlsKeyFile", "/key.pem");
			cfg.set("coder.tlsCaFile", "/ca.pem");

			const agent = await createHttpAgent(cfg);
			const opts = agent.connectOpts as AgentOpts;

			expect(Buffer.isBuffer(opts.cert) && opts.cert.toString()).toBe(
				"cert-content",
			);
			expect(Buffer.isBuffer(opts.key) && opts.key.toString()).toBe(
				"key-content",
			);
			expect(Buffer.isBuffer(opts.ca) && opts.ca.toString()).toBe("ca-content");
		});

		it("leaves cert options undefined when files not configured", async () => {
			const cfg = new MockConfigurationProvider();

			const agent = await createHttpAgent(cfg);
			const opts = agent.connectOpts as AgentOpts;

			expect(opts.cert).toBeUndefined();
			expect(opts.key).toBeUndefined();
			expect(opts.ca).toBeUndefined();
		});

		it("sets servername from tlsAltHost", async () => {
			const cfg = new MockConfigurationProvider();
			cfg.set("coder.tlsAltHost", "alt.example.com");

			const agent = await createHttpAgent(cfg);
			const opts = agent.connectOpts as AgentOpts;

			expect(opts.servername).toBe("alt.example.com");
		});
	});

	describe("TLS verification", () => {
		interface TlsVerificationCase {
			name: string;
			config: Record<string, boolean>;
			expected: boolean;
		}

		it.each<TlsVerificationCase>([
			{ name: "enabled by default", config: {}, expected: true },
			{
				name: "disabled when proxyStrictSSL=false",
				config: { "http.proxyStrictSSL": false },
				expected: false,
			},
			{
				name: "disabled when insecure=true",
				config: { "coder.insecure": true },
				expected: false,
			},
			{
				name: "disabled when both proxyStrictSSL=false and insecure=false",
				config: { "http.proxyStrictSSL": false, "coder.insecure": false },
				expected: false,
			},
			{
				name: "disabled when insecure overrides proxyStrictSSL",
				config: { "http.proxyStrictSSL": true, "coder.insecure": true },
				expected: false,
			},
		])("rejectUnauthorized=$expected ($name)", async ({ config, expected }) => {
			const cfg = new MockConfigurationProvider();
			Object.entries(config).forEach(([k, v]) => cfg.set(k, v));

			const agent = await createHttpAgent(cfg);
			const opts = agent.connectOpts as AgentOpts;

			expect(opts.rejectUnauthorized).toBe(expected);
		});
	});

	describe("proxy authorization", () => {
		it("sets Proxy-Authorization header when configured", async () => {
			const cfg = new MockConfigurationProvider();
			// VS Code's http.proxyAuthorization is the complete header value
			cfg.set("http.proxyAuthorization", "Basic dXNlcjpwYXNz");

			const agent = await createHttpAgent(cfg);

			expect(agent.connectOpts?.headers).toEqual({
				"Proxy-Authorization": "Basic dXNlcjpwYXNz",
			});
		});

		it("omits headers when proxyAuthorization is not set", async () => {
			const cfg = new MockConfigurationProvider();

			const agent = await createHttpAgent(cfg);

			expect(agent.connectOpts?.headers).toBeUndefined();
		});
	});

	describe("proxy resolution", () => {
		// Our getProxyForUrl wrapper only uses the URL, not the request object.
		// The request parameter exists to match proxy-agent's callback signature.
		const mockRequest = {} as http.ClientRequest;
		const proxy = "http://proxy.example.com:8080";

		it("uses http.proxy setting", async () => {
			const cfg = new MockConfigurationProvider();
			cfg.set("http.proxy", proxy);

			const agent = await createHttpAgent(cfg);

			expect(
				await agent.getProxyForUrl("https://example.com", mockRequest),
			).toBe(proxy);
		});

		it("bypasses proxy for hosts in coder.proxyBypass", async () => {
			const cfg = new MockConfigurationProvider();
			cfg.set("http.proxy", proxy);
			cfg.set("coder.proxyBypass", "internal.example.com");

			const agent = await createHttpAgent(cfg);

			expect(
				await agent.getProxyForUrl("https://internal.example.com", mockRequest),
			).toBe("");
			expect(
				await agent.getProxyForUrl("https://external.example.com", mockRequest),
			).toBe(proxy);
		});

		it("uses http.noProxy as fallback when coder.proxyBypass is not set", async () => {
			const cfg = new MockConfigurationProvider();
			cfg.set("http.proxy", proxy);
			cfg.set("http.noProxy", ["internal.example.com"]);

			const agent = await createHttpAgent(cfg);

			expect(
				await agent.getProxyForUrl("https://internal.example.com", mockRequest),
			).toBe("");
		});

		it("prefers coder.proxyBypass over http.noProxy", async () => {
			const cfg = new MockConfigurationProvider();
			cfg.set("http.proxy", proxy);
			cfg.set("coder.proxyBypass", "primary.example.com");
			cfg.set("http.noProxy", ["fallback.example.com"]);

			const agent = await createHttpAgent(cfg);

			expect(
				await agent.getProxyForUrl("https://primary.example.com", mockRequest),
			).toBe("");
			expect(
				await agent.getProxyForUrl("https://fallback.example.com", mockRequest),
			).toBe(proxy);
		});

		it("trims and joins multiple http.noProxy entries", async () => {
			const cfg = new MockConfigurationProvider();
			cfg.set("http.proxy", proxy);
			cfg.set("http.noProxy", [" first.example.com ", "second.example.com "]);

			const agent = await createHttpAgent(cfg);

			expect(
				await agent.getProxyForUrl("https://first.example.com", mockRequest),
			).toBe("");
			expect(
				await agent.getProxyForUrl("https://second.example.com", mockRequest),
			).toBe("");
			expect(
				await agent.getProxyForUrl("https://other.example.com", mockRequest),
			).toBe(proxy);
		});

		interface NoProxyTestCase {
			name: string;
			noProxy: string[] | undefined;
		}
		it.each<NoProxyTestCase>([
			{ name: "undefined", noProxy: undefined },
			{ name: "empty array", noProxy: [] },
		])("uses proxy when http.noProxy is $name", async ({ noProxy }) => {
			const cfg = new MockConfigurationProvider();
			cfg.set("http.proxy", proxy);
			cfg.set("http.noProxy", noProxy);

			const agent = await createHttpAgent(cfg);

			expect(
				await agent.getProxyForUrl("https://example.com", mockRequest),
			).toBe(proxy);
		});
	});
});
