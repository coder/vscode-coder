import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as vscode from "vscode";

import { LocalProxySettings } from "@/settings/proxy";

import { config, type Settings } from "../../mocks/testHelpers";

const LOCAL_PROXY = "http://local-proxy.example.com:8080";
const REMOTE_PROXY = "http://remote-proxy.example.com:8080";

// Uses the instance that test/unit/setup.ts initializes for each test.
function setup(remoteName: string | undefined, initial: Settings) {
	vi.mocked(vscode.env).remoteName = remoteName;
	onTestFinished(() => {
		vi.mocked(vscode.env).remoteName = undefined;
	});
	const cfg = config(initial);
	return {
		cfg,
		proxy: () => LocalProxySettings.get("http.proxy"),
		/** Mimic VS Code making `http.*` machine scoped after connecting. */
		switchToRemoteSettings(remote: Settings) {
			cfg.set("http.useLocalProxyConfiguration", false);
			for (const [key, value] of Object.entries(remote)) {
				cfg.set(key, value);
			}
		},
	};
}

describe("LocalProxySettings", () => {
	it("keeps the last local proxy values after VS Code switches to remote settings", () => {
		const { cfg, proxy, switchToRemoteSettings } = setup("ssh-remote", {
			"http.proxy": "http://stale.example.com",
		});
		cfg.set("http.proxy", LOCAL_PROXY);

		switchToRemoteSettings({
			"http.proxy": REMOTE_PROXY,
			"http.proxyStrictSSL": false,
		});

		expect(proxy()).toBe(LOCAL_PROXY);
		expect(LocalProxySettings.get("http.proxyStrictSSL")).toBeUndefined();
	});

	it("reads live values when the remote uses the local proxy configuration", () => {
		const { cfg, proxy } = setup("ssh-remote", {
			"http.useLocalProxyConfiguration": true,
		});

		cfg.set("http.proxy", LOCAL_PROXY);

		expect(proxy()).toBe(LOCAL_PROXY);
	});

	it("reads live values in a local window", () => {
		const { proxy, switchToRemoteSettings } = setup(undefined, {
			"http.proxy": LOCAL_PROXY,
		});

		switchToRemoteSettings({ "http.proxy": REMOTE_PROXY });

		expect(proxy()).toBe(REMOTE_PROXY);
	});

	it("throws when initialized twice", () => {
		expect(() => LocalProxySettings.initialize()).toThrow(
			"LocalProxySettings has already been initialized",
		);
	});
});
