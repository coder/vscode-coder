import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type AuthorityClassification,
	type AuthorityParts,
	classifySshHost,
	hostEditorId,
	isRemoteAuthorityCompatible,
	parseRemoteAuthority,
	toLegacyAuthority,
	toRemoteAuthority,
} from "@/remote/authority";

import { useEditor } from "../../mocks/testHelpers";

const CURSOR_AUTHORITY = "ssh-remote+coder-cursor.dev.coder.com--foo--bar.main";
const LEGACY_AUTHORITY = "ssh-remote+coder-vscode.dev.coder.com--foo--bar.main";
const DEVIN_AUTHORITY = "ssh-remote+coder-devin.dev.coder.com--foo--bar.main";

const parts = (prefix: string): AuthorityParts => ({
	agent: "main",
	hostPrefix: `${prefix}.dev.coder.com--`,
	sshHost: `${prefix}.dev.coder.com--foo--bar.main`,
	safeHostname: "dev.coder.com",
	username: "foo",
	workspace: "bar",
});

describe("parseRemoteAuthority", () => {
	afterEach(() => vi.restoreAllMocks());

	it("applies Windows filename restrictions to a directly supplied authority", () => {
		const authority = "ssh-remote+coder-vscode.[::1]--foo--bar";
		vi.spyOn(os, "platform").mockReturnValue("linux");
		expect(parseRemoteAuthority(authority)?.safeHostname).toBe("[::1]");
		vi.spyOn(os, "platform").mockReturnValue("win32");
		expect(() => parseRemoteAuthority(authority)).toThrow(
			/Cannot connect on Windows/,
		);
	});

	interface ClassificationCase {
		editor: string;
		prefix: string;
		expected: AuthorityClassification;
	}
	it.each<ClassificationCase>([
		{ editor: "vscode", prefix: "coder-vscode", expected: "current" },
		{ editor: "vscode", prefix: "coder-vscode-insiders", expected: "foreign" },
		{ editor: "cursor", prefix: "coder-vscode", expected: "legacy" },
		{
			editor: "vscode-insiders",
			prefix: "coder-vscode-insiders",
			expected: "current",
		},
		{
			editor: "vscode-insiders",
			prefix: "coder-vscode",
			expected: "legacy",
		},
	])(
		"classifies $prefix as $expected in $editor",
		({ editor, prefix, expected }) => {
			useEditor(editor);
			expect(classifySshHost(parts(prefix).sshHost)).toBe(expected);
		},
	);

	interface MalformedAuthorityCase {
		editor: string;
		sshHost: string;
	}
	it.each<MalformedAuthorityCase>([
		{ editor: "vscode", sshHost: "coder-vscode.dev.coder.com--foo" },
		{ editor: "cursor", sshHost: "coder-vscode.dev.coder.com--foo" },
		{ editor: "vscode", sshHost: "coder-vscode.--foo--bar" },
		{ editor: "vscode", sshHost: "coder-vscode.dev.coder.com----bar" },
		{ editor: "vscode", sshHost: "coder-vscode.dev.coder.com--foo--" },
		{ editor: "vscode", sshHost: "coder-vscode.dev.coder.com--foo--.main" },
		{ editor: "vscode", sshHost: "coder-vscode.dev.coder.com--foo--bar." },
	])("rejects malformed current or legacy authority", ({ editor, sshHost }) => {
		useEditor(editor);
		expect(() => parseRemoteAuthority(`ssh-remote+${sshHost}`)).toThrow(
			"Invalid Coder SSH authority",
		);
	});

	it("ignores unrelated and malformed foreign authorities", () => {
		expect(parseRemoteAuthority("github.com")).toBeNull();
		expect(parseRemoteAuthority("ssh-remote+coder-vscode")).toBeNull();
		useEditor("cursor");
		expect(
			parseRemoteAuthority("ssh-remote+coder-devin.dev.coder.com--foo"),
		).toBeNull();
	});

	it.each(["vscode", "cursor"])(
		"ignores deployment-unaware historical hosts in %s",
		(editor) => {
			useEditor(editor);
			// Old versions created hosts matching the preserved `Host coder-vscode--*` block.
			expect(
				parseRemoteAuthority("ssh-remote+coder-vscode--user--workspace.main"),
			).toBeNull();
		},
	);

	// The grammar is covered in common/validation.test.ts; these check that
	// parsing applies it to the hostname and the identifiers.
	it.each([
		[
			"command substitution in workspace",
			"coder-vscode.dev.coder.com--foo--x$(touch /tmp/pwned)",
		],
		[
			"space in hostname (would split the Host pattern)",
			"coder-vscode.evil *--foo--bar",
		],
		["path traversal hostname", "coder-vscode...--foo--bar"],
		["IPv6 zone token", "coder-vscode.[::1%h]--foo--bar"],
		["path separator in hostname", "coder-vscode.a/b--foo--bar"],
	])("rejects unexpected characters: %s", (_label, sshHost) => {
		expect(() => parseRemoteAuthority(`ssh-remote+${sshHost}`)).toThrow(
			/Cannot (use|connect)/,
		);
	});

	interface ParseCase {
		sshHost: string;
		safeHostname: string;
		workspace: string;
		agent: string;
	}
	it.each<ParseCase>([
		{
			sshHost: "coder-vscode.dev.coder.com--foo--bar",
			safeHostname: "dev.coder.com",
			workspace: "bar",
			agent: "",
		},
		{
			sshHost: "coder-vscode.first--middle--last.example--foo--bar.main",
			safeHostname: "first--middle--last.example",
			workspace: "bar",
			agent: "main",
		},
	])(
		"parses $sshHost from the right",
		({ sshHost, safeHostname, workspace, agent }) => {
			expect(parseRemoteAuthority(`ssh-remote+${sshHost}`)).toStrictEqual({
				agent,
				hostPrefix: `coder-vscode.${safeHostname}--`,
				sshHost,
				safeHostname,
				username: "foo",
				workspace,
			} satisfies AuthorityParts);
		},
	);

	interface WrappedAuthorityCase {
		label: string;
		authority: string;
	}
	it.each<WrappedAuthorityCase>([
		{ label: "plain", authority: CURSOR_AUTHORITY },
		{ label: "URI", authority: `vscode://${CURSOR_AUTHORITY}` },
		{
			label: "multiply nested",
			authority: `attached-container+def@dev-container+abc@${CURSOR_AUTHORITY}`,
		},
	])("parses $label wrapper", ({ authority }) => {
		useEditor("cursor");
		expect(parseRemoteAuthority(authority)).toStrictEqual(
			parts("coder-cursor"),
		);
	});
});

describe("authority construction", () => {
	it("preserves the editor URI scheme and integrates with toSafeHost", () => {
		useEditor("cursor--dev");
		expect(
			toRemoteAuthority("https://ほげ", "alice", "workspace", "main"),
		).toBe("ssh-remote+coder-cursor--dev.xn--18j4d--alice--workspace.main");
	});

	it.each(["-dev", "dev-", "dev_1", "_dev_"])(
		"round-trips legacy agent %j without changing the authority format",
		(agent) => {
			const authority = toRemoteAuthority(
				"https://xn--bcher-kva.example",
				"alice",
				"dev",
				agent,
			);
			expect(authority).toBe(
				`ssh-remote+coder-vscode.xn--bcher-kva.example--alice--dev.${agent}`,
			);
			expect(parseRemoteAuthority(authority)).toMatchObject({
				safeHostname: "xn--bcher-kva.example",
				username: "alice",
				workspace: "dev",
				agent,
			});
		},
	);

	it("omits an absent agent", () => {
		expect(
			toRemoteAuthority("https://dev.coder.com", "foo", "bar", undefined),
		).toBe("ssh-remote+coder-vscode.dev.coder.com--foo--bar");
	});

	it("formats the current host prefix", () => {
		useEditor("vscode-insiders");
		expect(
			parseRemoteAuthority(
				"ssh-remote+coder-vscode-insiders.dev.coder.com--foo--bar",
			)?.hostPrefix,
		).toBe("coder-vscode-insiders.dev.coder.com--");
	});

	it("rejects an empty editor URI scheme at prefix construction", () => {
		useEditor("");
		expect(() =>
			toRemoteAuthority("https://dev.coder.com", "foo", "bar", undefined),
		).toThrow("must not be empty");
	});

	// One payload per parameter; the grammar is covered in common/validation.test.ts.
	it.each([
		{
			label: "command substitution in workspace name",
			owner: "foo",
			workspace: "x$(touch /tmp/pwned)",
			agent: undefined,
		},
		{
			label: "backticks in owner name",
			owner: "x`id`",
			workspace: "bar",
			agent: undefined,
		},
		{
			label: "shell metacharacters in agent name",
			owner: "foo",
			workspace: "bar",
			agent: "baz;ls",
		},
	])(
		"rejects server-provided identifiers with $label",
		({ owner, workspace, agent }) => {
			expect(() =>
				toRemoteAuthority("https://dev.coder.com", owner, workspace, agent),
			).toThrow(/Cannot (use|connect)/);
		},
	);

	// Filename safety does not imply shell safety; construction guards both.
	it.each(["https://a$(id).com", "https://a;id.com", "https://a&id.com"])(
		"rejects shell-unsafe deployment host %j",
		(baseUrl) => {
			expect(() => toRemoteAuthority(baseUrl, "foo", "bar", undefined)).toThrow(
				/Cannot use this deployment hostname/,
			);
		},
	);
});

describe("legacy authority compatibility", () => {
	interface CompatibilityCase {
		label: string;
		authority: string | undefined;
		expected: boolean;
	}
	it.each<CompatibilityCase>([
		{ label: "exact current", authority: CURSOR_AUTHORITY, expected: true },
		{ label: "retargeted legacy", authority: LEGACY_AUTHORITY, expected: true },
		{ label: "missing", authority: undefined, expected: false },
		{
			label: "malformed legacy",
			authority: "ssh-remote+coder-vscode",
			expected: false,
		},
		{ label: "foreign", authority: DEVIN_AUTHORITY, expected: false },
		{
			label: "different wrapper",
			authority: `dev-container+abc@${LEGACY_AUTHORITY}`,
			expected: false,
		},
	])("requires exact compatibility for $label", ({ authority, expected }) => {
		useEditor("cursor");
		expect(isRemoteAuthorityCompatible(authority, CURSOR_AUTHORITY)).toBe(
			expected,
		);
	});

	it.each([
		{ label: "plain", authority: CURSOR_AUTHORITY, expected: LEGACY_AUTHORITY },
		{
			label: "multiply nested",
			authority: `attached-container+def@dev-container+abc@${CURSOR_AUTHORITY}`,
			expected: `attached-container+def@dev-container+abc@${LEGACY_AUTHORITY}`,
		},
		{
			label: "already legacy",
			authority: LEGACY_AUTHORITY,
			expected: LEGACY_AUTHORITY,
		},
		{ label: "foreign", authority: DEVIN_AUTHORITY, expected: DEVIN_AUTHORITY },
		{ label: "non-remote", authority: "github.com", expected: "github.com" },
	])(
		"moves the $label authority to the legacy host",
		({ authority, expected }) => {
			useEditor("cursor");
			expect(toLegacyAuthority(authority)).toBe(expected);
		},
	);
});

describe("hostEditorId", () => {
	interface HostEditorCase {
		editor: string;
		sshHost: string;
		expected: string;
	}
	it.each<HostEditorCase>([
		{
			editor: "cursor",
			sshHost: "coder-cursor.dev--foo--bar",
			expected: "cursor",
		},
		{
			editor: "cursor",
			sshHost: "coder-vscode.dev--foo--bar",
			expected: "vscode",
		},
		{
			editor: "vscode",
			sshHost: "coder-vscode.dev--foo--bar",
			expected: "vscode",
		},
	])(
		"$editor serves $sshHost from $expected's file",
		({ editor, sshHost, expected }) => {
			useEditor(editor);
			expect(hostEditorId(sshHost)).toBe(expected);
		},
	);
});
