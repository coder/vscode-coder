import { vol } from "memfs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createHttpAgent, needToken } from "@/api/utils";

import {
	config,
	PROXY_URL as proxy,
	withProxy,
	type Settings,
} from "../../mocks/testHelpers";

import type * as http from "node:http";
import type { ConnectionOptions } from "node:tls";
import type { ProxyAgentOptions } from "proxy-agent";

vi.mock("node:fs/promises", async () => {
	const memfs = await import("memfs");
	return { default: memfs.fs.promises, ...memfs.fs.promises };
});

// ProxyAgentOptions uses '' as the URI type parameter, which makes ConnectOpts
// resolve to `never` and drops TLS fields. Re-add them for test assertions.
type AgentOpts = ProxyAgentOptions & ConnectionOptions;

const proxyAuthorization = "Basic dXNlcjpwYXNz";
// Our getProxyForUrl wrapper only uses the URL, not the request object.
// The request parameter exists to match proxy-agent's callback signature.
const mockRequest = {} as http.ClientRequest;

const proxyEnvVars = [
	"HTTP_PROXY",
	"http_proxy",
	"HTTPS_PROXY",
	"https_proxy",
	"ALL_PROXY",
	"all_proxy",
	"npm_config_http_proxy",
	"NPM_CONFIG_HTTP_PROXY",
	"npm_config_https_proxy",
	"NPM_CONFIG_HTTPS_PROXY",
	"npm_config_proxy",
	"NPM_CONFIG_PROXY",
	"NO_PROXY",
	"no_proxy",
	"npm_config_no_proxy",
	"NPM_CONFIG_NO_PROXY",
];

async function createAgentOptions(settings: Settings = {}) {
	const agent = await createHttpAgent(config(settings));
	return agent.connectOpts as AgentOpts | undefined;
}

async function createProxyResolver(settings: Settings = {}) {
	const agent = await createHttpAgent(config(settings));
	return async (url = "https://example.com"): Promise<string> =>
		await agent.getProxyForUrl(url, mockRequest);
}

async function proxyForUrl(
	settings: Settings,
	url = "https://example.com",
): Promise<string> {
	const getProxy = await createProxyResolver(settings);
	return await getProxy(url);
}

function clearProxyEnv(): void {
	for (const envVar of proxyEnvVars) {
		vi.stubEnv(envVar, "");
	}
}

describe("needToken", () => {
	interface NeedTokenCase {
		name: string;
		settings: Settings;
		expected: boolean;
	}

	it.each<NeedTokenCase>([
		{ name: "no mTLS certificates", settings: {}, expected: true },
		{
			name: "cert file configured",
			settings: { "coder.tlsCertFile": "/cert.pem" },
			expected: false,
		},
		{
			name: "key file configured",
			settings: { "coder.tlsKeyFile": "/key.pem" },
			expected: false,
		},
		{
			name: "both cert and key configured",
			settings: {
				"coder.tlsCertFile": "/cert.pem",
				"coder.tlsKeyFile": "/key.pem",
			},
			expected: false,
		},
	])("returns $expected when $name", ({ settings, expected }) => {
		expect(needToken(config(settings))).toBe(expected);
	});
});

describe("createHttpAgent", () => {
	beforeEach(() => {
		vol.reset();
		vi.unstubAllEnvs();
		clearProxyEnv();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("TLS certificates", () => {
		it("reads certificate files from disk", async () => {
			vol.fromJSON({
				"/cert.pem": "cert-content",
				"/key.pem": "key-content",
				"/ca.pem": "ca-content",
			});

			const opts = await createAgentOptions({
				"coder.tlsCertFile": "/cert.pem",
				"coder.tlsKeyFile": "/key.pem",
				"coder.tlsCaFile": "/ca.pem",
			});

			expect(Buffer.isBuffer(opts?.cert) && opts.cert.toString()).toBe(
				"cert-content",
			);
			expect(Buffer.isBuffer(opts?.key) && opts.key.toString()).toBe(
				"key-content",
			);
			expect(Buffer.isBuffer(opts?.ca) && opts.ca.toString()).toBe(
				"ca-content",
			);
		});

		it("leaves cert options undefined when files not configured", async () => {
			const opts = await createAgentOptions();

			expect(opts?.cert).toBeUndefined();
			expect(opts?.key).toBeUndefined();
			expect(opts?.ca).toBeUndefined();
		});

		it("sets servername from tlsAltHost", async () => {
			const opts = await createAgentOptions({
				"coder.tlsAltHost": "alt.example.com",
			});

			expect(opts?.servername).toBe("alt.example.com");
		});
	});

	describe("TLS verification", () => {
		interface TlsVerificationCase {
			name: string;
			settings: Settings;
			expected: boolean;
		}

		it.each<TlsVerificationCase>([
			{ name: "enabled by default", settings: {}, expected: true },
			{
				name: "disabled when proxyStrictSSL=false",
				settings: { "http.proxyStrictSSL": false },
				expected: false,
			},
			{
				name: "disabled when insecure=true",
				settings: { "coder.insecure": true },
				expected: false,
			},
			{
				name: "disabled when both proxyStrictSSL=false and insecure=false",
				settings: { "http.proxyStrictSSL": false, "coder.insecure": false },
				expected: false,
			},
			{
				name: "disabled when insecure overrides proxyStrictSSL",
				settings: { "http.proxyStrictSSL": true, "coder.insecure": true },
				expected: false,
			},
		])(
			"rejectUnauthorized=$expected ($name)",
			async ({ settings, expected }) => {
				const opts = await createAgentOptions(settings);

				expect(opts?.rejectUnauthorized).toBe(expected);
			},
		);
	});

	describe("proxy authorization", () => {
		interface ProxyAuthorizationCase {
			name: string;
			settings: Settings;
			expected: Record<string, string> | undefined;
		}

		it.each<ProxyAuthorizationCase>([
			{
				name: "sets Proxy-Authorization header when configured",
				settings: { "http.proxyAuthorization": proxyAuthorization },
				expected: { "Proxy-Authorization": proxyAuthorization },
			},
			{
				name: "omits headers when proxyAuthorization is not set",
				settings: {},
				expected: undefined,
			},
			{
				name: "ignores proxyAuthorization when proxy support is off",
				settings: {
					"http.proxySupport": "off",
					"http.proxyAuthorization": proxyAuthorization,
				},
				expected: undefined,
			},
		])("$name", async ({ settings, expected }) => {
			const opts = await createAgentOptions(settings);

			expect(opts?.headers).toEqual(expected);
		});
	});

	describe("proxy resolution", () => {
		interface ProxySupportCase {
			name: string;
			settings: Settings;
		}

		it.each<ProxySupportCase>([
			{ name: "unset", settings: withProxy() },
			{
				name: "on",
				settings: withProxy({ "http.proxySupport": "on" }),
			},
			{
				name: "fallback",
				settings: withProxy({ "http.proxySupport": "fallback" }),
			},
			{
				name: "override",
				settings: withProxy({ "http.proxySupport": "override" }),
			},
		])(
			"uses http.proxy setting when proxy support is $name",
			async ({ settings }) => {
				expect(await proxyForUrl(settings)).toBe(proxy);
			},
		);

		it("preserves inherited proxy env when proxy support is off", async () => {
			vi.stubEnv("HTTPS_PROXY", "http://env-proxy.example.com:8080");

			expect(
				await proxyForUrl(
					withProxy({
						"http.proxySupport": "off",
						"coder.proxyBypass": "example.com",
						"http.noProxy": ["example.com"],
					}),
				),
			).toBe("http://env-proxy.example.com:8080");
		});

		interface ProxyResolutionCase {
			name: string;
			settings: Settings;
			expectedByUrl: Record<string, string>;
		}

		it.each<ProxyResolutionCase>([
			{
				name: "ignores VS Code proxy settings when proxy support is off",
				settings: withProxy({
					"http.proxySupport": "off",
					"coder.proxyBypass": "example.com",
					"http.noProxy": ["example.com"],
				}),
				expectedByUrl: { "https://example.com": "" },
			},
			{
				name: "bypasses proxy for hosts in coder.proxyBypass",
				settings: withProxy({
					"coder.proxyBypass": "internal.example.com",
				}),
				expectedByUrl: {
					"https://internal.example.com": "",
					"https://external.example.com": proxy,
				},
			},
			{
				name: "uses http.noProxy as fallback when coder.proxyBypass is not set",
				settings: withProxy({
					"http.noProxy": ["internal.example.com"],
				}),
				expectedByUrl: { "https://internal.example.com": "" },
			},
			{
				name: "prefers coder.proxyBypass over http.noProxy",
				settings: withProxy({
					"coder.proxyBypass": "primary.example.com",
					"http.noProxy": ["fallback.example.com"],
				}),
				expectedByUrl: {
					"https://primary.example.com": "",
					"https://fallback.example.com": proxy,
				},
			},
			{
				name: "trims and joins multiple http.noProxy entries",
				settings: withProxy({
					"http.noProxy": [" first.example.com ", "second.example.com "],
				}),
				expectedByUrl: {
					"https://first.example.com": "",
					"https://second.example.com": "",
					"https://other.example.com": proxy,
				},
			},
		])("$name", async ({ settings, expectedByUrl }) => {
			const getProxy = await createProxyResolver(settings);
			for (const [url, expected] of Object.entries(expectedByUrl)) {
				expect(await getProxy(url)).toBe(expected);
			}
		});

		interface NoProxyTestCase {
			name: string;
			noProxy: string[] | undefined;
		}

		it.each<NoProxyTestCase>([
			{ name: "undefined", noProxy: undefined },
			{ name: "empty array", noProxy: [] },
		])("uses proxy when http.noProxy is $name", async ({ noProxy }) => {
			expect(await proxyForUrl(withProxy({ "http.noProxy": noProxy }))).toBe(
				proxy,
			);
		});
	});
});
