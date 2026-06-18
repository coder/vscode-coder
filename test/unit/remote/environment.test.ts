import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import {
	applySshEnvironment,
	getSshProxyEnvironment,
} from "@/remote/environment";

import { MockConfigurationProvider } from "../../mocks/testHelpers";

const URL = "https://coder.example.com";
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
			name: "drops the proxy when the deployment is bypassed",
			settings: {
				"http.proxy": proxy,
				"coder.proxyBypass": "coder.example.com",
			},
			expected: { NO_PROXY: "coder.example.com" },
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
	])("$name", ({ settings, expected }) => {
		const { config } = setup();

		expect(getSshProxyEnvironment(URL, config(settings))).toEqual(expected);
	});

	it("ignores an existing env proxy when http.proxy is unset", () => {
		const { config } = setup();
		vi.stubEnv("HTTPS_PROXY", "http://env-proxy.example.com:8080");

		expect(getSshProxyEnvironment(URL, config())).toEqual({});
	});
});

describe("applySshEnvironment", () => {
	it("applies and restores proxy variables", () => {
		const { config } = setup();
		const env: Record<string, string | undefined> = {};

		const applied = applySshEnvironment(
			URL,
			config({
				"http.proxy": proxy,
				"coder.proxyBypass": "internal.example.com",
			}),
			env,
		);
		expect(env).toEqual({
			HTTP_PROXY: proxy,
			HTTPS_PROXY: proxy,
			NO_PROXY: "internal.example.com",
		});

		applied.dispose();
		expect(env).toEqual({});
	});

	it("overwrites and restores existing lowercase variables", () => {
		const { config } = setup();
		const original = {
			http_proxy: "http://old-http-proxy.example.com:8080",
			https_proxy: "http://old-https-proxy.example.com:8080",
		};
		const env: Record<string, string | undefined> = { ...original };

		const applied = applySshEnvironment(
			URL,
			config({ "http.proxy": proxy }),
			env,
		);
		expect(env).toEqual({ http_proxy: proxy, https_proxy: proxy });

		applied.dispose();
		expect(env).toEqual(original);
	});

	it("propagates proxy variables to newly spawned child processes", () => {
		const { config } = setup();
		const applied = applySshEnvironment(URL, config({ "http.proxy": proxy }));

		try {
			expect(getProxyEnvFromChild()).toEqual({ http: proxy, https: proxy });
		} finally {
			applied.dispose();
		}
	});
});

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
