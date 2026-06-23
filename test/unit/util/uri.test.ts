import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	normalizeUrl,
	openInBrowser,
	removeTrailingSlashes,
	resolveUiUrl,
	toSafeHost,
} from "@/util/uri";

import { MockConfigurationProvider } from "../../mocks/testHelpers";

describe("toSafeHost", () => {
	it.each([
		["https://foobar:8080", "foobar"],
		["https://ほげ", "xn--18j4d"],
		["https://عربي", "xn--ngbrx4e"],
		["https://test.😉.invalid", "test.xn--n28h.invalid"],
		["https://dev.😉-coder.com", "dev.xn---coder-vx74e.com"],
		["http://ignore-port.com:8080", "ignore-port.com"],
	])("returns %s for %s", (input, expected) => {
		expect(toSafeHost(input)).toBe(expected);
	});

	it("throws for invalid URLs", () => {
		expect(() => toSafeHost("invalid url")).toThrow("Invalid URL");
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

describe("resolveUiUrl", () => {
	let configurationProvider: MockConfigurationProvider;

	beforeEach(() => {
		configurationProvider = new MockConfigurationProvider();
	});

	it("returns the connection URL when no alternative is configured", () => {
		expect(resolveUiUrl("https://coder.example.com:7004")).toBe(
			"https://coder.example.com:7004",
		);
	});

	it.each([
		{ name: "empty", value: "" },
		{ name: "whitespace", value: "   " },
	])(
		"returns the connection URL when the alternative is $name",
		({ value }) => {
			configurationProvider.set("coder.alternativeWebUrl", value);
			expect(resolveUiUrl("https://coder.example.com:7004")).toBe(
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
		expect(resolveUiUrl("https://coder.example.com:7004")).toBe(
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
