import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
	applySshProxyEnvironment,
	getSshProxyEnvironment,
} from "@/remote/environment";

import { MockConfigurationProvider } from "../../mocks/testHelpers";

describe("getSshProxyEnvironment", () => {
	const proxy = "http://proxy.example.com:8080";

	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	it("sets both proxy variables from http.proxy", () => {
		const cfg = new MockConfigurationProvider();
		cfg.set("http.proxy", proxy);

		expect(getSshProxyEnvironment("https://coder.example.com", cfg)).toEqual({
			HTTP_PROXY: proxy,
			HTTPS_PROXY: proxy,
		});
	});

	it("does not set proxy variables when the deployment is bypassed", () => {
		const cfg = new MockConfigurationProvider();
		cfg.set("http.proxy", proxy);
		cfg.set("coder.proxyBypass", "coder.example.com");

		expect(getSshProxyEnvironment("https://coder.example.com", cfg)).toEqual({
			NO_PROXY: "coder.example.com",
		});
	});

	it("uses http.noProxy when coder.proxyBypass is not set", () => {
		const cfg = new MockConfigurationProvider();
		cfg.set("http.proxy", proxy);
		cfg.set("http.noProxy", [" first.example.com ", "second.example.com "]);

		expect(getSshProxyEnvironment("https://coder.example.com", cfg)).toEqual({
			HTTP_PROXY: proxy,
			HTTPS_PROXY: proxy,
			NO_PROXY: "first.example.com,second.example.com",
		});
	});

	it("prefers coder.proxyBypass over http.noProxy", () => {
		const cfg = new MockConfigurationProvider();
		cfg.set("http.proxy", proxy);
		cfg.set("coder.proxyBypass", "primary.example.com");
		cfg.set("http.noProxy", ["fallback.example.com"]);

		expect(getSshProxyEnvironment("https://coder.example.com", cfg)).toEqual({
			HTTP_PROXY: proxy,
			HTTPS_PROXY: proxy,
			NO_PROXY: "primary.example.com",
		});
	});

	it("does not inherit proxy variables without http.proxy", () => {
		vi.stubEnv("HTTPS_PROXY", "http://env-proxy.example.com:8080");
		const cfg = new MockConfigurationProvider();

		expect(getSshProxyEnvironment("https://coder.example.com", cfg)).toEqual(
			{},
		);
	});
});

describe("applySshProxyEnvironment", () => {
	const proxy = "http://proxy.example.com:8080";

	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	it("applies and restores proxy environment variables", () => {
		const cfg = new MockConfigurationProvider();
		cfg.set("http.proxy", proxy);
		cfg.set("coder.proxyBypass", "internal.example.com");
		const env: Record<string, string | undefined> = {};

		const applied = applySshProxyEnvironment(
			"https://coder.example.com",
			cfg,
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

	it("updates existing environment variable casing", () => {
		const cfg = new MockConfigurationProvider();
		cfg.set("http.proxy", proxy);
		const env: Record<string, string | undefined> = {
			http_proxy: "http://old-http-proxy.example.com:8080",
			https_proxy: "http://old-https-proxy.example.com:8080",
		};

		const applied = applySshProxyEnvironment(
			"https://coder.example.com",
			cfg,
			env,
		);

		expect(env).toEqual({
			http_proxy: proxy,
			https_proxy: proxy,
		});

		applied.dispose();

		expect(env).toEqual({
			http_proxy: "http://old-http-proxy.example.com:8080",
			https_proxy: "http://old-https-proxy.example.com:8080",
		});
	});

	it("propagates proxy variables to newly spawned child processes", () => {
		const cfg = new MockConfigurationProvider();
		cfg.set("http.proxy", proxy);
		const applied = applySshProxyEnvironment("https://coder.example.com", cfg);

		try {
			expect(getProxyEnvFromChild()).toEqual({
				http: proxy,
				https: proxy,
			});
		} finally {
			applied.dispose();
		}
	});
});

interface ChildProxyEnvironment {
	http: string;
	https: string;
}

function getProxyEnvFromChild(): ChildProxyEnvironment {
	const result = spawnSync(
		process.execPath,
		[
			"-e",
			"process.stdout.write(JSON.stringify({ http: process.env.HTTP_PROXY || process.env.http_proxy, https: process.env.HTTPS_PROXY || process.env.https_proxy }))",
		],
		{ encoding: "utf8" },
	);

	expect(result.status).toBe(0);
	return JSON.parse(result.stdout) as ChildProxyEnvironment;
}
