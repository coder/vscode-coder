import os from "node:os";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import {
	type AuthorityParts,
	countSubstring,
	escapeCommandArg,
	expandPath,
	findPort,
	parseRemoteAuthority,
	renameWithRetry,
	tempFilePath,
	toSafeHost,
} from "@/util";

describe("parseRemoteAuthority", () => {
	it.each([
		"vscode://ssh-remote+some-unrelated-host.com",
		"vscode://ssh-remote+coder-vscode",
		"vscode://ssh-remote+coder-vscode-test",
		"vscode://ssh-remote+coder-vscode-test--foo--bar",
		"vscode://ssh-remote+coder-vscode-foo--bar",
		"vscode://ssh-remote+coder--foo--bar",
	])("ignores unrelated authority: %s", (input) => {
		expect(parseRemoteAuthority(input)).toBe(null);
	});

	it.each([
		"vscode://ssh-remote+coder-vscode--foo",
		"vscode://ssh-remote+coder-vscode--",
		"vscode://ssh-remote+coder-vscode--foo--",
		"vscode://ssh-remote+coder-vscode--foo--bar--",
	])("rejects invalid authority: %s", (input) => {
		expect(() => parseRemoteAuthority(input)).toThrow("Invalid");
	});

	interface ParseCase {
		label: string;
		input: string;
		expected: AuthorityParts;
	}

	it.each<ParseCase>([
		{
			label: "legacy form, no agent",
			input: "vscode://ssh-remote+coder-vscode--foo--bar",
			expected: {
				agent: "",
				sshHost: "coder-vscode--foo--bar",
				safeHostname: "",
				username: "foo",
				workspace: "bar",
			},
		},
		{
			label: "legacy form with agent",
			input: "vscode://ssh-remote+coder-vscode--foo--bar--baz",
			expected: {
				agent: "baz",
				sshHost: "coder-vscode--foo--bar--baz",
				safeHostname: "",
				username: "foo",
				workspace: "bar",
			},
		},
		{
			label: "with hostname, no agent",
			input: "vscode://ssh-remote+coder-vscode.dev.coder.com--foo--bar",
			expected: {
				agent: "",
				sshHost: "coder-vscode.dev.coder.com--foo--bar",
				safeHostname: "dev.coder.com",
				username: "foo",
				workspace: "bar",
			},
		},
		{
			label: "with hostname and -- agent",
			input: "vscode://ssh-remote+coder-vscode.dev.coder.com--foo--bar--baz",
			expected: {
				agent: "baz",
				sshHost: "coder-vscode.dev.coder.com--foo--bar--baz",
				safeHostname: "dev.coder.com",
				username: "foo",
				workspace: "bar",
			},
		},
		{
			label: "with hostname and . agent",
			input: "vscode://ssh-remote+coder-vscode.dev.coder.com--foo--bar.baz",
			expected: {
				agent: "baz",
				sshHost: "coder-vscode.dev.coder.com--foo--bar.baz",
				safeHostname: "dev.coder.com",
				username: "foo",
				workspace: "bar",
			},
		},
		{
			label: "Punycode label in hostname",
			input:
				"vscode://ssh-remote+coder-vscode.dev.coder.xn--eckwd4c7cu47r2wf.jp--foo--bar",
			expected: {
				agent: "",
				sshHost: "coder-vscode.dev.coder.xn--eckwd4c7cu47r2wf.jp--foo--bar",
				safeHostname: "dev.coder.xn--eckwd4c7cu47r2wf.jp",
				username: "foo",
				workspace: "bar",
			},
		},
		{
			label: "Punycode hostname with -- agent",
			input:
				"vscode://ssh-remote+coder-vscode.xn--eckwd4c7cu47r2wf.jp--foo--bar--baz",
			expected: {
				agent: "baz",
				sshHost: "coder-vscode.xn--eckwd4c7cu47r2wf.jp--foo--bar--baz",
				safeHostname: "xn--eckwd4c7cu47r2wf.jp",
				username: "foo",
				workspace: "bar",
			},
		},
		{
			label: "Punycode hostname with . agent",
			input:
				"vscode://ssh-remote+coder-vscode.xn--eckwd4c7cu47r2wf.jp--foo--bar.baz",
			expected: {
				agent: "baz",
				sshHost: "coder-vscode.xn--eckwd4c7cu47r2wf.jp--foo--bar.baz",
				safeHostname: "xn--eckwd4c7cu47r2wf.jp",
				username: "foo",
				workspace: "bar",
			},
		},
		{
			label: "multiple Punycode labels",
			input: "vscode://ssh-remote+coder-vscode.xn--abc.xn--def.com--foo--bar",
			expected: {
				agent: "",
				sshHost: "coder-vscode.xn--abc.xn--def.com--foo--bar",
				safeHostname: "xn--abc.xn--def.com",
				username: "foo",
				workspace: "bar",
			},
		},
		{
			label: "apex Punycode",
			input: "vscode://ssh-remote+coder-vscode.xn--p1ai--owner--ws",
			expected: {
				agent: "",
				sshHost: "coder-vscode.xn--p1ai--owner--ws",
				safeHostname: "xn--p1ai",
				username: "owner",
				workspace: "ws",
			},
		},
		{
			label: "consecutive apex Punycode labels",
			input: "vscode://ssh-remote+coder-vscode.xn--p1ai.xn--abc--owner--ws",
			expected: {
				agent: "",
				sshHost: "coder-vscode.xn--p1ai.xn--abc--owner--ws",
				safeHostname: "xn--p1ai.xn--abc",
				username: "owner",
				workspace: "ws",
			},
		},
	])("parses $label", ({ input, expected }) => {
		expect(parseRemoteAuthority(input)).toStrictEqual(expected);
	});
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
	it("wraps simple string in quotes", () => {
		expect(escapeCommandArg("hello")).toBe('"hello"');
	});

	it("handles empty string", () => {
		expect(escapeCommandArg("")).toBe('""');
	});

	it("escapes double quotes", () => {
		expect(escapeCommandArg('say "hello"')).toBe(String.raw`"say \"hello\""`);
	});

	it("preserves backslashes", () => {
		expect(escapeCommandArg(String.raw`path\to\file`)).toBe(
			String.raw`"path\to\file"`,
		);
	});

	it("handles string with spaces", () => {
		expect(escapeCommandArg("hello world")).toBe('"hello world"');
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

describe("tempFilePath", () => {
	it("prepends basePath and suffix before the random part", () => {
		const result = tempFilePath("/a/b/file", "temp");
		const prefix = "/a/b/file.temp-";
		expect(result.startsWith(prefix)).toBe(true);
		// prefix(15) + uuid(8) = 23
		expect(result).toHaveLength(prefix.length + 8);
	});

	it("generates different paths on each call", () => {
		const a = tempFilePath("/x", "tmp");
		const b = tempFilePath("/x", "tmp");
		expect(a).not.toBe(b);
	});

	it("uses the provided suffix", () => {
		const result = tempFilePath("/base", "old");
		expect(result.startsWith("/base.old-")).toBe(true);
	});
});

describe("renameWithRetry", () => {
	const realPlatform = process.platform;

	function makeErrno(code: string): NodeJS.ErrnoException {
		const err = new Error(code);
		(err as NodeJS.ErrnoException).code = code;
		return err;
	}

	function setPlatform(value: string) {
		Object.defineProperty(process, "platform", { value });
	}

	afterEach(() => {
		setPlatform(realPlatform);
		vi.useRealTimers();
	});

	it("succeeds on first attempt", async () => {
		const renameFn = vi.fn<(s: string, d: string) => Promise<void>>();
		renameFn.mockResolvedValueOnce(undefined);
		await renameWithRetry(renameFn, "/a", "/b");
		expect(renameFn).toHaveBeenCalledTimes(1);
		expect(renameFn).toHaveBeenCalledWith("/a", "/b");
	});

	it("skips retry logic on non-Windows platforms", async () => {
		setPlatform("linux");
		const renameFn = vi.fn<(s: string, d: string) => Promise<void>>();
		renameFn.mockRejectedValueOnce(makeErrno("EPERM"));

		await expect(renameWithRetry(renameFn, "/a", "/b")).rejects.toThrow(
			"EPERM",
		);
		expect(renameFn).toHaveBeenCalledTimes(1);
	});

	describe("on Windows", () => {
		beforeEach(() => setPlatform("win32"));

		it.each(["EPERM", "EACCES", "EBUSY"])(
			"retries on transient %s and succeeds",
			async (code) => {
				const renameFn = vi.fn<(s: string, d: string) => Promise<void>>();
				renameFn
					.mockRejectedValueOnce(makeErrno(code))
					.mockResolvedValueOnce(undefined);

				await renameWithRetry(renameFn, "/a", "/b", 60_000, 10);
				expect(renameFn).toHaveBeenCalledTimes(2);
			},
		);

		it("throws after timeout is exceeded", async () => {
			vi.useFakeTimers();
			const renameFn = vi.fn<(s: string, d: string) => Promise<void>>();
			const epermError = makeErrno("EPERM");
			renameFn.mockImplementation(() => Promise.reject(epermError));

			const promise = renameWithRetry(renameFn, "/a", "/b", 5);
			const assertion = expect(promise).rejects.toThrow(epermError);
			await vi.advanceTimersByTimeAsync(100);
			await assertion;
		});

		it.each(["EXDEV", "ENOENT", "EISDIR"])(
			"does not retry non-transient %s",
			async (code) => {
				const renameFn = vi.fn<(s: string, d: string) => Promise<void>>();
				renameFn.mockRejectedValueOnce(makeErrno(code));

				await expect(renameWithRetry(renameFn, "/a", "/b")).rejects.toThrow(
					code,
				);
				expect(renameFn).toHaveBeenCalledTimes(1);
			},
		);
	});
});
