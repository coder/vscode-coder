import { describe, it, expect } from "vitest";

import { countSubstring, parseRemoteAuthority, toSafeHost } from "@/util";

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
