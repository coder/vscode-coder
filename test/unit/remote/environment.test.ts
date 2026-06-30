import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import {
	applySshEnvironment,
	getSshProxyEnvironment,
} from "@/remote/environment";

import { MockConfigurationProvider } from "../../mocks/testHelpers";

const proxy = "http://proxy.example.com:8080";

function setup() {
	vi.unstubAllEnvs();
	return {
		config(settings: Record<string, unknown> = {}): MockConfigurationProvider {
			const cfg = new MockConfigurationProvider();
			for (const [key, value] of Object.entries(settings)) {
				cfg.set(key, value);
			}
			return cfg;
		},
	};
}

describe("getSshProxyEnvironment", () => {
	it.each([
		{
			name: "sets both proxy variables from http.proxy",
			settings: { "http.proxy": proxy },
			expected: { HTTP_PROXY: proxy, HTTPS_PROXY: proxy },
		},
		{
			name: "sets both proxy variables when proxy support is on",
			settings: { "http.proxy": proxy, "http.proxySupport": "on" },
			expected: { HTTP_PROXY: proxy, HTTPS_PROXY: proxy },
		},
		{
			name: "sets both proxy variables when proxy support is fallback",
			settings: { "http.proxy": proxy, "http.proxySupport": "fallback" },
			expected: { HTTP_PROXY: proxy, HTTPS_PROXY: proxy },
		},
		{
			name: "sets both proxy variables when proxy support is override",
			settings: { "http.proxy": proxy, "http.proxySupport": "override" },
			expected: { HTTP_PROXY: proxy, HTTPS_PROXY: proxy },
		},
		{
			name: "ignores VS Code proxy settings when proxy support is off",
			settings: {
				"http.proxy": proxy,
				"http.proxySupport": "off",
				"coder.proxyBypass": "coder.example.com",
				"http.noProxy": ["fallback.example.com"],
			},
			expected: {},
		},
		{
			name: "passes through the proxy when the deployment is bypassed",
			settings: {
				"http.proxy": proxy,
				"coder.proxyBypass": "coder.example.com",
			},
			expected: {
				HTTP_PROXY: proxy,
				HTTPS_PROXY: proxy,
				NO_PROXY: "coder.example.com",
			},
		},
		{
			name: "falls back to http.noProxy when coder.proxyBypass is unset",
			settings: {
				"http.proxy": proxy,
				"http.noProxy": [" first.example.com ", "second.example.com "],
			},
			expected: {
				HTTP_PROXY: proxy,
				HTTPS_PROXY: proxy,
				NO_PROXY: "first.example.com,second.example.com",
			},
		},
		{
			name: "prefers coder.proxyBypass over http.noProxy",
			settings: {
				"http.proxy": proxy,
				"coder.proxyBypass": "primary.example.com",
				"http.noProxy": ["fallback.example.com"],
			},
			expected: {
				HTTP_PROXY: proxy,
				HTTPS_PROXY: proxy,
				NO_PROXY: "primary.example.com",
			},
		},
		{
			name: "ignores a whitespace-only http.proxy",
			settings: { "http.proxy": "   " },
			expected: {},
		},
		{
			name: "falls back to http.noProxy when coder.proxyBypass is whitespace",
			settings: {
				"http.proxy": proxy,
				"coder.proxyBypass": "   ",
				"http.noProxy": ["fallback.example.com"],
			},
			expected: {
				HTTP_PROXY: proxy,
				HTTPS_PROXY: proxy,
				NO_PROXY: "fallback.example.com",
			},
		},
	])("$name", ({ settings, expected }) => {
		const { config } = setup();

		expect(getSshProxyEnvironment(config(settings))).toEqual(expected);
	});

	it("ignores an existing env proxy when http.proxy is unset", () => {
		const { config } = setup();
		vi.stubEnv("HTTPS_PROXY", "http://env-proxy.example.com:8080");

		expect(getSshProxyEnvironment(config())).toEqual({});
	});
});

describe("applySshEnvironment", () => {
	it("applies proxy variables to process.env and the collection, and restores on dispose", () => {
		const { config } = setup();
		const env: Record<string, string | undefined> = {};
		const collection = fakeEnvCollection();

		const applied = applySshEnvironment(
			config({
				"http.proxy": proxy,
				"coder.proxyBypass": "internal.example.com",
			}),
			collection,
			env,
		);
		const expected = {
			HTTP_PROXY: proxy,
			HTTPS_PROXY: proxy,
			NO_PROXY: "internal.example.com",
		};
		expect(env).toEqual(expected);
		expect(collection.vars).toEqual(expected);
		expect(collection.persistent).toBe(false);

		applied.dispose();
		expect(env).toEqual({});
		expect(collection.vars).toEqual({});
	});

	it("sets nothing when no proxy is configured", () => {
		const { config } = setup();
		const env: Record<string, string | undefined> = {};
		const collection = fakeEnvCollection();

		applySshEnvironment(config(), collection, env);

		expect(env).toEqual({});
		expect(collection.vars).toEqual({});
	});

	it("does not clear existing env proxy variables when proxy support is off", () => {
		const { config } = setup();
		const original = {
			HTTP_PROXY: "http://old-http-proxy.example.com:8080",
			HTTPS_PROXY: "http://old-https-proxy.example.com:8080",
		};
		const env: Record<string, string | undefined> = { ...original };
		const collection = fakeEnvCollection();

		applySshEnvironment(
			config({ "http.proxy": proxy, "http.proxySupport": "off" }),
			collection,
			env,
		);

		expect(env).toEqual(original);
		expect(collection.vars).toEqual({});
	});

	it("does not overwrite existing lowercase variables", () => {
		const { config } = setup();
		const original = {
			http_proxy: "http://old-http-proxy.example.com:8080",
			https_proxy: "http://old-https-proxy.example.com:8080",
		};
		const env: Record<string, string | undefined> = { ...original };

		const applied = applySshEnvironment(
			config({ "http.proxy": proxy }),
			fakeEnvCollection(),
			env,
		);
		expect(env).toEqual({
			...original,
			HTTP_PROXY: proxy,
			HTTPS_PROXY: proxy,
		});

		applied.dispose();
		expect(env).toEqual(original);
	});

	it("restores existing case-insensitive variables", () => {
		const { config } = setup();
		const original = "http://old-http-proxy.example.com:8080";
		const env = caseInsensitiveEnvironment({ http_proxy: original });

		const applied = applySshEnvironment(
			config({ "http.proxy": proxy }),
			fakeEnvCollection(),
			env,
		);
		expect(env.HTTP_PROXY).toBe(proxy);
		expect(env.http_proxy).toBe(proxy);

		applied.dispose();
		expect(env.HTTP_PROXY).toBe(original);
		expect(env.http_proxy).toBe(original);
	});

	it("propagates proxy variables to newly spawned child processes", () => {
		const { config } = setup();
		const applied = applySshEnvironment(
			config({ "http.proxy": proxy }),
			fakeEnvCollection(),
		);

		try {
			expect(getProxyEnvFromChild()).toEqual({ http: proxy, https: proxy });
		} finally {
			applied.dispose();
		}
	});
});

function fakeEnvCollection() {
	const vars: Record<string, string> = {};
	return {
		persistent: true,
		replace: (variable: string, value: string) => {
			vars[variable] = value;
		},
		clear: () => {
			for (const key of Object.keys(vars)) {
				delete vars[key];
			}
		},
		vars,
	};
}

function caseInsensitiveEnvironment(
	values: Record<string, string>,
): Record<string, string | undefined> {
	return new Proxy(values, {
		get(target, property) {
			if (typeof property !== "string") {
				return undefined;
			}
			return target[getCaseInsensitiveKey(target, property) ?? property];
		},
		set(target, property, value) {
			if (typeof property !== "string") {
				return false;
			}
			target[getCaseInsensitiveKey(target, property) ?? property] = value;
			return true;
		},
		deleteProperty(target, property) {
			if (typeof property !== "string") {
				return false;
			}
			return delete target[getCaseInsensitiveKey(target, property) ?? property];
		},
	});
}

function getCaseInsensitiveKey(
	values: Record<string, string | undefined>,
	key: string,
): string | undefined {
	return Object.keys(values).find(
		(valueKey) => valueKey.toLowerCase() === key.toLowerCase(),
	);
}

function getProxyEnvFromChild(): { http: string; https: string } {
	const result = spawnSync(
		process.execPath,
		[
			"-e",
			"process.stdout.write(JSON.stringify({ http: process.env.HTTP_PROXY || process.env.http_proxy, https: process.env.HTTPS_PROXY || process.env.https_proxy }))",
		],
		{ encoding: "utf8" },
	);

	expect(result.status).toBe(0);
	return JSON.parse(result.stdout) as { http: string; https: string };
}
