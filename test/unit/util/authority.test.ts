import { describe, expect, it } from "vitest";

import {
	type AuthorityParts,
	parseRemoteAuthority,
	toRemoteAuthority,
} from "@/util/authority";

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

describe("toRemoteAuthority", () => {
	interface ToRemoteAuthorityCase {
		url: string;
		owner: string;
		workspace: string;
		agent: string | undefined;
		expected: string;
	}
	it.each<ToRemoteAuthorityCase>([
		{
			url: "https://dev.coder.com",
			owner: "foo",
			workspace: "bar",
			agent: undefined,
			expected: "ssh-remote+coder-vscode.dev.coder.com--foo--bar",
		},
		{
			url: "http://dev.coder.com:3000",
			owner: "foo",
			workspace: "bar",
			agent: "baz",
			expected: "ssh-remote+coder-vscode.dev.coder.com--foo--bar.baz",
		},
		{
			url: "https://coder.example.com/some/path?q=1",
			owner: "alice",
			workspace: "web",
			agent: "",
			expected: "ssh-remote+coder-vscode.coder.example.com--alice--web",
		},
		{
			url: "http://192.168.1.5:8080",
			owner: "foo",
			workspace: "bar",
			agent: undefined,
			expected: "ssh-remote+coder-vscode.192.168.1.5--foo--bar",
		},
		{
			url: "http://localhost:3000",
			owner: "dev",
			workspace: "ws",
			agent: "main",
			expected: "ssh-remote+coder-vscode.localhost--dev--ws.main",
		},
		{
			url: "https://sub.DOMAIN.Example.COM",
			owner: "foo",
			workspace: "bar",
			agent: undefined,
			expected: "ssh-remote+coder-vscode.sub.domain.example.com--foo--bar",
		},
		{
			url: "https://ほげ:8080",
			owner: "foo",
			workspace: "bar",
			agent: undefined,
			expected: "ssh-remote+coder-vscode.xn--18j4d--foo--bar",
		},
		{
			url: "https://عربي",
			owner: "foo",
			workspace: "bar",
			agent: undefined,
			expected: "ssh-remote+coder-vscode.xn--ngbrx4e--foo--bar",
		},
	])(
		"builds authority for $url",
		({ url, owner, workspace, agent, expected }) => {
			expect(toRemoteAuthority(url, owner, workspace, agent)).toBe(expected);
		},
	);
});
