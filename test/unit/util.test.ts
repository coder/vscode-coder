import os from "node:os";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";

import {
	type AuthorityParts,
	countSubstring,
	escapeCommandArg,
	escapeShellArg,
	expandPath,
	findPort,
	openInBrowser,
	parseRemoteAuthority,
	resolveUiUrl,
	toRemoteAuthority,
	toSafeHost,
} from "@/util";

import { MockConfigurationProvider } from "../mocks/testHelpers";

describe("parseRemoteAuthority", () => {
	const remoteAuthority = (sshHost: string) => `vscode://ssh-remote+${sshHost}`;

	it.each([
		{ label: "missing SSH host", input: "vscode://ssh-remote" },
		{ label: "empty SSH host", input: "vscode://ssh-remote+" },
		{
			label: "non-Coder host",
			input: remoteAuthority("some-unrelated-host.com"),
		},
		{
			label: "prefix without safeHostname separator",
			input: remoteAuthority("coder-vscode--foo--bar"),
		},
		{
			label: "similar prefix",
			input: remoteAuthority("coder-vscode-test--foo--bar"),
		},
		{ label: "wrong prefix", input: remoteAuthority("coder--foo--bar") },
	])("ignores unrelated authority: $label", ({ input }) => {
		expect(parseRemoteAuthority(input)).toBe(null);
	});

	it.each([
		{
			label: "missing username and workspace",
			sshHost: "coder-vscode.dev.coder.com",
		},
		{
			label: "missing workspace",
			sshHost: "coder-vscode.dev.coder.com--foo",
		},
		{
			label: "manual host using Coder prefix",
			sshHost: "coder-vscode.personal-host",
		},
		{
			label: "empty username",
			sshHost: "coder-vscode.dev.coder.com----bar",
		},
		{
			label: "empty workspace",
			sshHost: "coder-vscode.dev.coder.com--foo--",
		},
		{
			label: "empty hostname",
			sshHost: "coder-vscode.--foo--bar",
		},
		{
			label: "empty trailing segment",
			sshHost: "coder-vscode.dev.coder.com--foo--bar--",
		},
		{
			label: "empty workspace before agent separator",
			sshHost: "coder-vscode.dev.coder.com--foo--.agent",
		},
		{
			label: "empty agent after separator",
			sshHost: "coder-vscode.dev.coder.com--foo--bar.",
		},
	])("rejects invalid authority: $label", ({ sshHost }) => {
		expect(() => parseRemoteAuthority(remoteAuthority(sshHost))).toThrow(
			"Invalid Coder SSH authority",
		);
	});

	interface ParseCase {
		label: string;
		sshHost: string;
		safeHostname: string;
		workspace: string;
		agent?: string;
		username?: string;
	}

	it("round trips generated remote authorities", () => {
		const authority = toRemoteAuthority(
			"https://ほげ",
			"alice",
			"workspace",
			"main",
		);

		expect(authority).toBe(
			"ssh-remote+coder-vscode.xn--18j4d--alice--workspace.main",
		);
		expect(parseRemoteAuthority(authority)).toStrictEqual({
			agent: "main",
			sshHost: "coder-vscode.xn--18j4d--alice--workspace.main",
			safeHostname: "xn--18j4d",
			username: "alice",
			workspace: "workspace",
		} satisfies AuthorityParts);
	});

	it.each<ParseCase>([
		{
			label: "hostname without agent",
			sshHost: "coder-vscode.dev.coder.com--foo--bar",
			safeHostname: "dev.coder.com",
			workspace: "bar",
		},
		{
			label: "hostname with agent",
			sshHost: "coder-vscode.dev.coder.com--foo--bar.baz",
			safeHostname: "dev.coder.com",
			workspace: "bar",
			agent: "baz",
		},
		{
			label: "hostname containing delimiter",
			sshHost: "coder-vscode.test--domain.com--foo--bar",
			safeHostname: "test--domain.com",
			workspace: "bar",
		},
		{
			label: "Punycode hostname containing delimiter",
			sshHost: "coder-vscode.xn--test---8o4.example--foo--bar",
			safeHostname: "xn--test---8o4.example",
			workspace: "bar",
		},
		{
			label: "hostname with repeated delimiters and agent",
			sshHost: "coder-vscode.first--middle--last.example--foo--bar.baz",
			safeHostname: "first--middle--last.example",
			workspace: "bar",
			agent: "baz",
		},
		{
			label: "hostname with many consecutive dashes",
			sshHost: "coder-vscode.foo---------------bar.com--foo--bar",
			safeHostname: "foo---------------bar.com",
			workspace: "bar",
		},
		{
			label: "ambiguous workspace/agent separator",
			sshHost: "coder-vscode.dev.coder.com--foo--bar.baz.qux",
			safeHostname: "dev.coder.com",
			workspace: "bar.baz.qux",
		},
	])(
		"parses $label",
		({ sshHost, safeHostname, workspace, agent, username }) => {
			expect(parseRemoteAuthority(remoteAuthority(sshHost))).toStrictEqual({
				agent: agent ?? "",
				sshHost,
				safeHostname,
				username: username ?? "foo",
				workspace,
			} satisfies AuthorityParts);
		},
	);
});

describe("toSafeHost", () => {
	it("escapes url host", () => {
		expect(toSafeHost("https://foobar:8080")).toBe("foobar");
		expect(toSafeHost("https://ほげ")).toBe("xn--18j4d");
		expect(toSafeHost("https://test.😉.invalid")).toBe("test.xn--n28h.invalid");
		expect(toSafeHost("https://dev.😉-coder.com")).toBe(
			"dev.xn---coder-vx74e.com",
		);
		expect(() => toSafeHost("invalid url")).toThrow("Invalid URL");
		expect(toSafeHost("http://ignore-port.com:8080")).toBe("ignore-port.com");
	});
});

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
