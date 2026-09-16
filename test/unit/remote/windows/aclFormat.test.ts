import { describe, expect, it } from "vitest";

import {
	hasCanonicalExpectedFileAcl,
	isFullyQualifiedWindowsPath,
	parseWhoamiUserSid,
	readSavedAclDescriptor,
} from "@/remote/windows/aclFormat";

import { protectedAcl, SID, whoamiCsv } from "./fixtures";

describe("Windows ACL format", () => {
	interface PathCase {
		target: string;
		expected: boolean;
	}
	it.each<PathCase>([
		{ target: "C:\\Users\\coder\\config", expected: true },
		{ target: "C:/Users/coder/config", expected: true },
		{ target: "\\\\server\\share\\config", expected: true },
		{ target: "\\config", expected: false },
		{ target: "C:config", expected: false },
		{ target: "config", expected: false },
		{ target: "C:\\*.conf", expected: false },
	])(
		"recognizes $target as fully qualified: $expected",
		({ target, expected }) => {
			expect(isFullyQualifiedWindowsPath(target)).toBe(expected);
		},
	);

	interface UserSidCase {
		output: string;
		expected?: string;
	}
	it.each<UserSidCase>([
		{ output: whoamiCsv(), expected: SID },
		{ output: whoamiCsv("S-1-invalid") },
		{ output: `${whoamiCsv()},"extra"` },
	])("reads the SID from $output", ({ output, expected }) => {
		expect(parseWhoamiUserSid(output)).toBe(expected);
	});

	it("reads a matching UTF-16 backup entry", () => {
		expect(
			readSavedAclDescriptor(
				"C:\\config",
				`\uFEFFconfig\r\n${protectedAcl()}\r\n`,
			),
		).toBe(protectedAcl());
	});

	interface BackupCase {
		name: string;
		saved: string;
	}
	it.each<BackupCase>([
		{ name: "wrong file", saved: "other\r\nD:P" },
		{ name: "missing descriptor", saved: "config\r\n" },
		{ name: "extra entry", saved: "config\r\nD:P\r\nextra" },
	])("rejects a backup with $name", ({ saved }) => {
		expect(() => readSavedAclDescriptor("C:\\config", saved)).toThrow(
			"Unexpected Windows ACL backup format",
		);
	});

	interface DescriptorCase {
		name: string;
		descriptor: string;
		expected: boolean;
	}
	it.each<DescriptorCase>([
		{ name: "no SACL controls", descriptor: protectedAcl(), expected: true },
		{
			name: "protected SACL controls",
			descriptor: protectedAcl(SID, "S:PAIAR"),
			expected: true,
		},
		{
			name: "invalid SACL controls",
			descriptor: protectedAcl(SID, "S:XYZ"),
			expected: false,
		},
		{
			name: "unprotected DACL",
			descriptor: `D:(A;;FA;;;${SID})(A;;FA;;;SY)(A;;FA;;;BA)`,
			expected: false,
		},
		{
			name: "extra trustee",
			descriptor: `D:P(A;;FA;;;${SID})(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;WD)`,
			expected: false,
		},
		{
			name: "deny ACE",
			descriptor: `D:P(D;;FA;;;WD)(A;;FA;;;${SID})(A;;FA;;;SY)(A;;FA;;;BA)`,
			expected: false,
		},
		{
			name: "inheritance flags",
			descriptor: `D:P(A;OICI;FA;;;${SID})(A;;FA;;;SY)(A;;FA;;;BA)`,
			expected: false,
		},
		{
			name: "missing user",
			descriptor: "D:P(A;;FA;;;SY)(A;;FA;;;SY)(A;;FA;;;BA)",
			expected: false,
		},
	])("validates $name: $expected", ({ descriptor, expected }) => {
		expect(hasCanonicalExpectedFileAcl(descriptor, SID)).toBe(expected);
	});

	// icacls abbreviates well-known SIDs, and the local Administrator/Guest
	// aliases are only equivalent when they name the current user's own RID.
	interface TrusteeCase {
		account: string;
		trustee: string;
		expected: boolean;
	}
	it.each<TrusteeCase>([
		{ account: "S-1-5-18", trustee: "SY", expected: true },
		{ account: "S-1-5-21-1-2-3-500", trustee: "LA", expected: true },
		{ account: "S-1-5-21-1-2-3-501", trustee: "LG", expected: true },
		{ account: SID, trustee: "LA", expected: false },
		{
			account: "S-1-5-21-1-2-3-500",
			trustee: "S-1-5-21-9-8-7-500",
			expected: false,
		},
	])("checks $account against $trustee", ({ account, trustee, expected }) => {
		expect(hasCanonicalExpectedFileAcl(protectedAcl(trustee), account)).toBe(
			expected,
		);
	});
});
