import os from "node:os";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import {
	countSubstring,
	escapeCommandArg,
	escapeShellArg,
	expandPath,
	findPort,
} from "@/util";

describe("countSubstring", () => {
	it("handles empty strings", () => {
		expect(countSubstring("", "")).toBe(0);
		expect(countSubstring("foo", "")).toBe(0);
		expect(countSubstring("", "foo")).toBe(0);
	});

	it("handles single character", () => {
		expect(countSubstring("a", "a")).toBe(1);
		expect(countSubstring("a", "b")).toBe(0);
		expect(countSubstring("a", "aa")).toBe(2);
		expect(countSubstring("a", "aaa")).toBe(3);
		expect(countSubstring("a", "baaa")).toBe(3);
	});

	it("handles multiple characters", () => {
		expect(countSubstring("foo", "foo")).toBe(1);
		expect(countSubstring("foo", "bar")).toBe(0);
		expect(countSubstring("foo", "foobar")).toBe(1);
		expect(countSubstring("foo", "foobarbaz")).toBe(1);
		expect(countSubstring("foo", "foobarbazfoo")).toBe(2);
		expect(countSubstring("foo", "foobarbazfoof")).toBe(2);
	});

	it("does not handle overlapping substrings", () => {
		expect(countSubstring("aa", "aaa")).toBe(1);
		expect(countSubstring("aa", "aaaa")).toBe(2);
		expect(countSubstring("aa", "aaaaa")).toBe(2);
		expect(countSubstring("aa", "aaaaaa")).toBe(3);
	});
});

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

		it('doubles embedded `"`', () => {
			expect(escapeShellArg('regions=["us","eu"]')).toBe(
				'"regions=[""us"",""eu""]"',
			);
		});

		it("doubles `%` to block %VAR% expansion", () => {
			expect(escapeShellArg("%PATH%")).toBe('"%%PATH%%"');
		});

		it("keeps cmd metachars inside the quoted region", () => {
			expect(escapeShellArg('foo" & calc.exe & "x')).toBe(
				'"foo"" & calc.exe & ""x"',
			);
		});
	});
});

describe("expandPath", () => {
	const home = os.homedir();

	it("expands tilde at start of path", () => {
		expect(expandPath("~/foo/bar")).toBe(`${home}/foo/bar`);
	});

	it("expands standalone tilde", () => {
		expect(expandPath("~")).toBe(home);
	});

	it("does not expand tilde in middle of path", () => {
		expect(expandPath("/foo/~/bar")).toBe("/foo/~/bar");
	});

	it("expands ${userHome} variable", () => {
		expect(expandPath("${userHome}/foo")).toBe(`${home}/foo`);
	});

	it("expands multiple ${userHome} variables", () => {
		expect(expandPath("${userHome}/foo/${userHome}/bar")).toBe(
			`${home}/foo/${home}/bar`,
		);
	});

	it("leaves paths without tilde or variable unchanged", () => {
		expect(expandPath("/absolute/path")).toBe("/absolute/path");
		expect(expandPath("relative/path")).toBe("relative/path");
	});

	it("expands both tilde and ${userHome}", () => {
		expect(expandPath("~/${userHome}/foo")).toBe(`${home}/${home}/foo`);
	});

	describe("${env:VAR}", () => {
		const envKey = "CODER_EXPAND_PATH_TEST";
		const ref = "${env:" + envKey + "}";

		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it("substitutes a present env var", () => {
			vi.stubEnv(envKey, "/data");
			expect(expandPath(`${ref}/foo`)).toBe("/data/foo");
		});

		it("replaces a missing env var with an empty string", () => {
			vi.stubEnv(envKey, undefined);
			expect(expandPath(`prefix-${ref}-suffix`)).toBe("prefix--suffix");
		});

		it("substitutes multiple occurrences in one string", () => {
			vi.stubEnv(envKey, "data");
			expect(expandPath(`${ref}/${ref}`)).toBe("data/data");
		});

		it("expands tilde or ${userHome} that appears inside the env value", () => {
			vi.stubEnv(envKey, "~/projects");
			expect(expandPath(`${ref}/x`)).toBe(`${home}/projects/x`);
		});

		it("ignores ${env:...} with invalid names", () => {
			expect(expandPath("${env:1BAD}/x")).toBe("${env:1BAD}/x");
		});
	});
});

describe("findPort", () => {
	it.each([[""], ["some random log text without ports"]])(
		"returns null for <%s>",
		(input) => {
			expect(findPort(input)).toBe(null);
		},
	);

	it.each([
		[
			"ms-vscode-remote.remote-ssh",
			"[10:30:45] SSH established -> socksPort 12345 -> ready",
			12345,
		],
		[
			"ms-vscode-remote.remote-ssh[2]",
			"Forwarding between local port 54321 and remote",
			54321,
		],
		[
			"windsurf/open-remote-ssh/antigravity",
			"[INFO] Connection => 9999(socks) => target",
			9999,
		],
		[
			"anysphere.remote-ssh",
			"[DEBUG] Initialized Socks port: 8888 proxy",
			8888,
		],
	])("finds port from %s log format", (_name, input, expected) => {
		expect(findPort(input)).toBe(expected);
	});

	it("returns most recent port when multiple matches exist", () => {
		const log = `
[10:30:00] Starting connection -> socksPort 1111 -> initialized
[10:30:05] Reconnecting => 2222(socks) => retry
[10:30:10] Final connection Socks port: 3333 established
		`;
		expect(findPort(log)).toBe(3333);
	});
});
