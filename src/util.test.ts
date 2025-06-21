import { describe, it, expect } from "vitest";
import {
	countSubstring,
	escapeCommandArg,
	expandPath,
	findPort,
	parseRemoteAuthority,
	toRemoteAuthority,
	toSafeHost,
} from "./util";

it("ignore unrelated authorities", () => {
	const tests = [
		"vscode://ssh-remote+some-unrelated-host.com",
		"vscode://ssh-remote+coder-vscode",
		"vscode://ssh-remote+coder-vscode-test",
		"vscode://ssh-remote+coder-vscode-test--foo--bar",
		"vscode://ssh-remote+coder-vscode-foo--bar",
		"vscode://ssh-remote+coder--foo--bar",
	];
	for (const test of tests) {
		expect(parseRemoteAuthority(test)).toBe(null);
	}
});

it("should error on invalid authorities", () => {
	const tests = [
		"vscode://ssh-remote+coder-vscode--foo",
		"vscode://ssh-remote+coder-vscode--",
		"vscode://ssh-remote+coder-vscode--foo--",
		"vscode://ssh-remote+coder-vscode--foo--bar--",
	];
	for (const test of tests) {
		expect(() => parseRemoteAuthority(test)).toThrow("Invalid");
	}
});

it("should parse authority", () => {
	expect(
		parseRemoteAuthority("vscode://ssh-remote+coder-vscode--foo--bar"),
	).toStrictEqual({
		agent: "",
		host: "coder-vscode--foo--bar",
		label: "",
		username: "foo",
		workspace: "bar",
	});
	expect(
		parseRemoteAuthority("vscode://ssh-remote+coder-vscode--foo--bar--baz"),
	).toStrictEqual({
		agent: "baz",
		host: "coder-vscode--foo--bar--baz",
		label: "",
		username: "foo",
		workspace: "bar",
	});
	expect(
		parseRemoteAuthority(
			"vscode://ssh-remote+coder-vscode.dev.coder.com--foo--bar",
		),
	).toStrictEqual({
		agent: "",
		host: "coder-vscode.dev.coder.com--foo--bar",
		label: "dev.coder.com",
		username: "foo",
		workspace: "bar",
	});
	expect(
		parseRemoteAuthority(
			"vscode://ssh-remote+coder-vscode.dev.coder.com--foo--bar--baz",
		),
	).toStrictEqual({
		agent: "baz",
		host: "coder-vscode.dev.coder.com--foo--bar--baz",
		label: "dev.coder.com",
		username: "foo",
		workspace: "bar",
	});
	expect(
		parseRemoteAuthority(
			"vscode://ssh-remote+coder-vscode.dev.coder.com--foo--bar.baz",
		),
	).toStrictEqual({
		agent: "baz",
		host: "coder-vscode.dev.coder.com--foo--bar.baz",
		label: "dev.coder.com",
		username: "foo",
		workspace: "bar",
	});
});

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

describe("findPort", () => {
	it("should find port from Remote SSH log patterns", () => {
		expect(findPort("-> socksPort 12345 ->")).toBe(12345);
		expect(findPort("=> 9876(socks) =>")).toBe(9876);
		expect(findPort("between local port 8080")).toBe(8080);
	});

	it("should handle complex log text", () => {
		const logText = "some text before -> socksPort 54321 -> more text after";
		expect(findPort(logText)).toBe(54321);
	});

	it("should return null when no port found", () => {
		expect(findPort("no port here")).toBe(null);
		expect(findPort("")).toBe(null);
		expect(findPort("-> socksPort ->")).toBe(null);
	});

	it("should return null for invalid match patterns", () => {
		expect(findPort("-> socksPort")).toBe(null);
		expect(findPort("socksPort 12345")).toBe(null);
	});
});

describe("toRemoteAuthority", () => {
	it("should create remote authority without agent", () => {
		const result = toRemoteAuthority(
			"https://coder.com",
			"alice",
			"myworkspace",
			undefined,
		);
		expect(result).toBe(
			"ssh-remote+coder-vscode.coder.com--alice--myworkspace",
		);
	});

	it("should create remote authority with agent", () => {
		const result = toRemoteAuthority(
			"https://coder.com",
			"alice",
			"myworkspace",
			"main",
		);
		expect(result).toBe(
			"ssh-remote+coder-vscode.coder.com--alice--myworkspace.main",
		);
	});

	it("should handle URL with port", () => {
		const result = toRemoteAuthority(
			"https://coder.com:8080",
			"alice",
			"myworkspace",
			undefined,
		);
		expect(result).toBe(
			"ssh-remote+coder-vscode.coder.com--alice--myworkspace",
		);
	});

	it("should handle international domain", () => {
		const result = toRemoteAuthority(
			"https://ほげ.com",
			"alice",
			"myworkspace",
			"gpu",
		);
		expect(result).toBe(
			"ssh-remote+coder-vscode.xn--18j4d.com--alice--myworkspace.gpu",
		);
	});
});

describe("expandPath", () => {
	it("should expand userHome placeholder", () => {
		const result = expandPath("${userHome}/Documents");
		expect(result).toContain("/Documents");
		expect(result).not.toContain("${userHome}");
	});

	it("should handle multiple userHome placeholders", () => {
		const result = expandPath("${userHome}/docs/${userHome}/backup");
		expect(result).not.toContain("${userHome}");
		const parts = result.split("/");
		expect(parts.filter((p) => p.includes("docs")).length).toBe(1);
		expect(parts.filter((p) => p.includes("backup")).length).toBe(1);
	});

	it("should return unchanged string without userHome placeholder", () => {
		const input = "/usr/local/bin";
		expect(expandPath(input)).toBe(input);
	});

	it("should handle empty string", () => {
		expect(expandPath("")).toBe("");
	});
});

describe("escapeCommandArg", () => {
	it("should wrap argument in quotes", () => {
		expect(escapeCommandArg("simple")).toBe('"simple"');
	});

	it("should escape quotes in argument", () => {
		expect(escapeCommandArg('say "hello"')).toBe('"say \\"hello\\""');
	});

	it("should handle empty string", () => {
		expect(escapeCommandArg("")).toBe('""');
	});

	it("should handle string with spaces", () => {
		expect(escapeCommandArg("hello world")).toBe('"hello world"');
	});

	it("should handle multiple quotes", () => {
		expect(escapeCommandArg('"quoted" and "more"')).toBe(
			'"\\"quoted\\" and \\"more\\""',
		);
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
