import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	isSameOrigin,
	normalizeUrl,
	openInBrowser,
	removeTrailingSlashes,
	resolveCoderDashboardUrl,
	toSafeHost,
} from "@/common/url";

import { MockConfigurationProvider } from "../../mocks/testHelpers";

describe("toSafeHost", () => {
	afterEach(() => vi.restoreAllMocks());

	it("rejects a traversal hostname before it becomes a deployment directory", () => {
		expect(() => toSafeHost("https://..")).toThrow(
			/Cannot use this deployment hostname/,
		);
	});

	it("preserves the IPv6 deployment key on POSIX but rejects it on Windows", () => {
		vi.spyOn(os, "platform").mockReturnValue("linux");
		expect(toSafeHost("https://[::1]:8080")).toBe("[::1]_8080");
		vi.spyOn(os, "platform").mockReturnValue("win32");
		expect(() => toSafeHost("https://[::1]:8080")).toThrow(
			/Cannot connect on Windows/,
		);
	});

	it.each([
		["https://foobar", "foobar"],
		["https://foobar:443", "foobar"],
		["https://foobar:8080", "foobar_8080"],
		["http://foobar", "foobar_http"],
		["http://foobar:80", "foobar_http"],
		["http://foobar:8080", "foobar_http8080"],
		["https://foobar:80", "foobar_80"],
		["http://foobar:443", "foobar_http443"],
		["https://my_host", "my_host_https"],
		["https://my_host:8443", "my_host_8443"],
		["https://ほげ", "xn--18j4d"],
		["https://عربي", "xn--ngbrx4e"],
		["https://test.😉.invalid", "test.xn--n28h.invalid"],
		["https://dev.😉-coder.com", "dev.xn---coder-vx74e.com"],
	])("returns %s for %s", (input, expected) => {
		expect(toSafeHost(input)).toBe(expected);
	});

	it("gives two URLs the same label exactly when they share an origin", () => {
		const hosts = ["host", "HOST", "host.com", "my_host", "xn--n3h.com"];
		// Hostnames that look like another origin's label.
		hosts.push("host_80", "host_http", "host_https", "host_http8080");
		const urls = hosts.flatMap((host) =>
			["http", "https"].flatMap((scheme) =>
				["", ":80", ":443", ":8080"].map(
					(port) => `${scheme}://${host}${port}`,
				),
			),
		);

		for (const a of urls) {
			for (const b of urls) {
				expect(toSafeHost(a) === toSafeHost(b), `${a} vs ${b}`).toBe(
					new URL(a).origin === new URL(b).origin,
				);
			}
		}
	});

	it("rejects schemes other than http and https", () => {
		expect(() => toSafeHost("ftp://host")).toThrow("must use http or https");
	});

	it("throws for invalid URLs", () => {
		expect(() => toSafeHost("invalid url")).toThrow("Invalid URL");
	});
});

describe("isSameOrigin", () => {
	it.each([
		["https://coder.example.com:443/path", "https://coder.example.com", true],
		["https://coder.example.com", "http://coder.example.com", false],
		["https://coder.example.com", "https://coder.example.com:8443", false],
		["https://coder.example.com", "https://evil.example.com", false],
		["not a url", "https://coder.example.com", false],
		// Opaque origins are never comparable.
		["data:text/plain,x", "data:text/plain,x", false],
	])("isSameOrigin(%j, %j) === %j", (a, b, expected) => {
		expect(isSameOrigin(a, b)).toBe(expected);
	});
});

describe("removeTrailingSlashes", () => {
	it.each([
		["https://coder.example.com", "https://coder.example.com"],
		["https://coder.example.com/", "https://coder.example.com"],
		["https://coder.example.com///", "https://coder.example.com"],
		["///", ""],
	])("returns %j for %j", (input, expected) => {
		expect(removeTrailingSlashes(input)).toBe(expected);
	});
});

describe("normalizeUrl", () => {
	it.each([
		["https://coder.example.com", "https://coder.example.com"],
		["  https://coder.example.com  ", "https://coder.example.com"],
		["https://coder.example.com///", "https://coder.example.com"],
		["  https://coder.example.com/  ", "https://coder.example.com"],
		["", ""],
	])("returns %j for %j", (input, expected) => {
		expect(normalizeUrl(input)).toBe(expected);
	});
});

describe("resolveCoderDashboardUrl", () => {
	let configurationProvider: MockConfigurationProvider;

	beforeEach(() => {
		configurationProvider = new MockConfigurationProvider();
	});

	it("returns the connection URL when no alternative is configured", () => {
		expect(resolveCoderDashboardUrl("https://coder.example.com:7004")).toBe(
			"https://coder.example.com:7004",
		);
	});

	it.each([
		{ name: "empty", value: "" },
		{ name: "whitespace", value: "   " },
		{ name: "not http(s)", value: "vscode://some.extension/path" },
		{ name: "missing a scheme", value: "coder.example.com" },
	])(
		"returns the connection URL when the alternative is $name",
		({ value }) => {
			configurationProvider.set("coder.alternativeWebUrl", value);
			expect(resolveCoderDashboardUrl("https://coder.example.com:7004")).toBe(
				"https://coder.example.com:7004",
			);
		},
	);

	it.each([
		{
			name: "uses the alternative URL when configured",
			value: "https://coder.example.com",
		},
		{ name: "strips trailing slashes", value: "https://coder.example.com/" },
		{
			name: "strips multiple trailing slashes",
			value: "https://coder.example.com///",
		},
		{ name: "trims whitespace", value: "  https://coder.example.com  " },
	])("$name", ({ value }) => {
		configurationProvider.set("coder.alternativeWebUrl", value);
		expect(resolveCoderDashboardUrl("https://coder.example.com:7004")).toBe(
			"https://coder.example.com",
		);
	});
});

describe("openInBrowser", () => {
	let configurationProvider: MockConfigurationProvider;

	beforeEach(() => {
		configurationProvider = new MockConfigurationProvider();
		vi.mocked(vscode.env.openExternal).mockClear();
	});

	it("opens the connection URL joined with the path when no alt URL is set", () => {
		openInBrowser("https://coder.example.com:7004", "/templates");
		expect(vscode.env.openExternal).toHaveBeenCalledWith(
			vscode.Uri.parse("https://coder.example.com:7004/templates"),
		);
	});

	it("opens the alternative URL when configured", () => {
		configurationProvider.set(
			"coder.alternativeWebUrl",
			"https://coder.example.com",
		);
		openInBrowser("https://coder.example.com:7004", "/templates");
		expect(vscode.env.openExternal).toHaveBeenCalledWith(
			vscode.Uri.parse("https://coder.example.com/templates"),
		);
	});

	it("preserves a path prefix on the alternative URL", () => {
		configurationProvider.set(
			"coder.alternativeWebUrl",
			"https://proxy.example.com/coder",
		);
		openInBrowser("https://coder.example.com:7004", "/templates");
		expect(vscode.env.openExternal).toHaveBeenCalledWith(
			vscode.Uri.parse("https://proxy.example.com/coder/templates"),
		);
	});

	it("joins paths without a leading slash", () => {
		openInBrowser("https://coder.example.com", "templates");
		expect(vscode.env.openExternal).toHaveBeenCalledWith(
			vscode.Uri.parse("https://coder.example.com/templates"),
		);
	});
});
