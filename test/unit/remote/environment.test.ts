import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	applySshEnvironment,
	getSshProxyEnvironment,
} from "@/remote/environment";

import {
	config,
	PROXY_URL as proxy,
	withProxy,
	type Settings,
} from "../../mocks/testHelpers";

const proxyEnv = { HTTP_PROXY: proxy, HTTPS_PROXY: proxy };
type Environment = Record<string, string | undefined>;

beforeEach(() => {
	vi.unstubAllEnvs();
});

describe("getSshProxyEnvironment", () => {
	interface ProxyEnvironmentCase {
		name: string;
		settings: Settings;
		expected: Record<string, string>;
	}

	it.each<ProxyEnvironmentCase>([
		{
			name: "sets both proxy variables from http.proxy",
			settings: withProxy(),
			expected: proxyEnv,
		},
		{
			name: "sets both proxy variables when proxy support is on",
			settings: withProxy({ "http.proxySupport": "on" }),
			expected: proxyEnv,
		},
		{
			name: "sets both proxy variables when proxy support is fallback",
			settings: withProxy({ "http.proxySupport": "fallback" }),
			expected: proxyEnv,
		},
		{
			name: "sets both proxy variables when proxy support is override",
			settings: withProxy({ "http.proxySupport": "override" }),
			expected: proxyEnv,
		},
		{
			name: "ignores VS Code proxy settings when proxy support is off",
			settings: withProxy({
				"http.proxySupport": "off",
				"coder.proxyBypass": "coder.example.com",
				"http.noProxy": ["fallback.example.com"],
			}),
			expected: {},
		},
		{
			name: "passes through the proxy when the deployment is bypassed",
			settings: withProxy({ "coder.proxyBypass": "coder.example.com" }),
			expected: { ...proxyEnv, NO_PROXY: "coder.example.com" },
		},
		{
			name: "falls back to http.noProxy when coder.proxyBypass is unset",
			settings: withProxy({
				"http.noProxy": [" first.example.com ", "second.example.com "],
			}),
			expected: {
				...proxyEnv,
				NO_PROXY: "first.example.com,second.example.com",
			},
		},
		{
			name: "prefers coder.proxyBypass over http.noProxy",
			settings: withProxy({
				"coder.proxyBypass": "primary.example.com",
				"http.noProxy": ["fallback.example.com"],
			}),
			expected: { ...proxyEnv, NO_PROXY: "primary.example.com" },
		},
		{
			name: "ignores a whitespace-only http.proxy",
			settings: { "http.proxy": "   " },
			expected: {},
		},
		{
			name: "falls back to http.noProxy when coder.proxyBypass is whitespace",
			settings: withProxy({
				"coder.proxyBypass": "   ",
				"http.noProxy": ["fallback.example.com"],
			}),
			expected: { ...proxyEnv, NO_PROXY: "fallback.example.com" },
		},
	])("$name", ({ settings, expected }) => {
		expect(getSshProxyEnvironment(config(settings))).toEqual(expected);
	});

	it("ignores an existing env proxy when http.proxy is unset", () => {
		vi.stubEnv("HTTPS_PROXY", "http://env-proxy.example.com:8080");

		expect(getSshProxyEnvironment(config())).toEqual({});
	});
});

describe("applySshEnvironment", () => {
	it("applies proxy variables to process.env and the collection, and restores on dispose", () => {
		const env: Environment = {};
		const collection = fakeEnvCollection();
		const expected = { ...proxyEnv, NO_PROXY: "internal.example.com" };

		const applied = applySshEnvironment(
			config(withProxy({ "coder.proxyBypass": "internal.example.com" })),
			collection,
			env,
		);

		expect(env).toEqual(expected);
		expect(collection.vars).toEqual(expected);
		expect(collection.persistent).toBe(false);

		applied.dispose();
		expect(env).toEqual({});
		expect(collection.vars).toEqual({});
	});

	it("sets nothing when no proxy is configured", () => {
		const env: Environment = {};
		const collection = fakeEnvCollection();

		applySshEnvironment(config(), collection, env);

		expect(env).toEqual({});
		expect(collection.vars).toEqual({});
	});

	it("does not clear existing env proxy variables when proxy support is off", () => {
		const original = {
			HTTP_PROXY: "http://old-http-proxy.example.com:8080",
			HTTPS_PROXY: "http://old-https-proxy.example.com:8080",
		};
		const env: Environment = { ...original };
		const collection = fakeEnvCollection();

		applySshEnvironment(
			config(withProxy({ "http.proxySupport": "off" })),
			collection,
			env,
		);

		expect(env).toEqual(original);
		expect(collection.vars).toEqual({});
	});

	it("does not overwrite existing lowercase variables", () => {
		const original = {
			http_proxy: "http://old-http-proxy.example.com:8080",
			https_proxy: "http://old-https-proxy.example.com:8080",
		};
		const env: Environment = { ...original };

		const applied = applySshEnvironment(
			config(withProxy()),
			fakeEnvCollection(),
			env,
		);

		expect(env).toEqual({ ...original, ...proxyEnv });

		applied.dispose();
		expect(env).toEqual(original);
	});

	it("restores existing case-insensitive variables", () => {
		const original = "http://old-http-proxy.example.com:8080";
		const env = caseInsensitiveEnvironment({ http_proxy: original });

		const applied = applySshEnvironment(
			config(withProxy()),
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
		const applied = applySshEnvironment(
			config(withProxy()),
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
): Environment {
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
