import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	escapeCommandArg,
	escapeProxyCommandArg,
	escapeShellArg,
} from "@/common/strings";

describe("escapeCommandArg", () => {
	it("returns simple strings unquoted", () => {
		expect(escapeCommandArg("hello")).toBe("hello");
	});

	it("returns flag-style strings unquoted", () => {
		expect(escapeCommandArg("--verbose")).toBe("--verbose");
		expect(escapeCommandArg("--cfg=/etc/coder")).toBe("--cfg=/etc/coder");
	});

	it("quotes the empty string so it survives as a token", () => {
		expect(escapeCommandArg("")).toBe('""');
	});

	it.each([["--token="], ["=x"], ["x==y"]])(
		"quotes a leading, trailing or doubled `=`: %j",
		(input) => {
			expect(escapeCommandArg(input)).toBe(`"${input}"`);
		},
	);

	it("escapes double quotes and wraps in quotes", () => {
		expect(escapeCommandArg('say "hello"')).toBe(String.raw`"say \"hello\""`);
	});

	it("quotes backslashes (POSIX escape char)", () => {
		expect(escapeCommandArg(String.raw`path\to\file`)).toBe(
			String.raw`"path\to\file"`,
		);
	});

	it("quotes strings containing spaces", () => {
		expect(escapeCommandArg("hello world")).toBe('"hello world"');
	});

	it.each([["tab\there"], ["line\nbreak"], ["vtab\vhere"]])(
		"quotes strings containing other whitespace: %j",
		(input) => {
			expect(escapeCommandArg(input)).toBe(`"${input}"`);
		},
	);

	it.each([
		["foo&bar"],
		["foo;bar"],
		["foo|bar"],
		["foo(bar)"],
		["foo<bar"],
		["foo>bar"],
		["foo*bar"],
		["foo?bar"],
		["foo$bar"],
		["foo`bar"],
		["foo~bar"],
		["foo!bar"],
		["foo#bar"],
		["https://x.com?a=1&b=2"],
	])("quotes strings containing shell metacharacter: %j", (input) => {
		expect(escapeCommandArg(input)).toBe(`"${input}"`);
	});
});

describe("escapeShellArg", () => {
	const platformSpy = vi.spyOn(os, "platform");
	afterEach(() => platformSpy.mockReset());

	describe("on Unix", () => {
		beforeEach(() => platformSpy.mockReturnValue("linux"));

		it("wraps in single quotes", () => {
			expect(escapeShellArg("env=dev")).toBe("'env=dev'");
		});

		it("escapes single quotes via the '\\'' sequence", () => {
			expect(escapeShellArg("it's fine")).toBe("'it'\\''s fine'");
		});

		it("leaves $VAR, $(...), and backticks literal inside the quotes", () => {
			expect(escapeShellArg("$(echo pwned)")).toBe("'$(echo pwned)'");
		});
	});

	describe("on Windows", () => {
		beforeEach(() => platformSpy.mockReturnValue("win32"));

		it("wraps in double quotes", () => {
			expect(escapeShellArg("env=dev")).toBe('"env=dev"');
		});

		it.each([
			['regions=["us","eu"]', String.raw`"regions=[\"us\",\"eu\"]"`],
			['C:\\a b\\ \\"x\\', '"C:\\a b\\ \\\\\\"x\\\\"'],
		])('escapes `"` and the backslashes before it in %j', (value, expected) => {
			expect(escapeShellArg(value)).toBe(expected);
		});

		it("doubles `%` so OpenSSH token expansion keeps it literal", () => {
			expect(escapeShellArg("%PATH%")).toBe('"%%PATH%%"');
		});
	});
});

describe("escapeProxyCommandArg", () => {
	it.each([
		["--token=", escapeCommandArg],
		['say "hi"', escapeCommandArg],
		["get-headers --profile 'prod' | jq", escapeCommandArg],
		["$TOKEN", escapeShellArg],
		["`whoami`", escapeShellArg],
		[String.raw`a\b`, escapeShellArg],
		["%h", escapeShellArg],
		["line\nbreak", escapeShellArg],
	])("quotes %j", (value, escape) => {
		expect(escapeProxyCommandArg(value)).toBe(escape(value));
	});
});
