import { describe, expect, it } from "vitest";

import {
	hasCanonicalExpectedFileAcl,
	isFullyQualifiedWindowsPath,
	parseWhoamiUserSid,
	readSavedAclDescriptor,
} from "@/remote/windowsAclFormat";

const sid = "S-1-5-21-1-2-3-1001";

function protectedAcl(user = sid, suffix = ""): string {
	return `D:PAI(A;;FA;;;${user})(A;;FA;;;SY)(A;;FA;;;BA)${suffix}`;
}

describe("Windows ACL format", () => {
	it("accepts only fully qualified drive and UNC paths", () => {
		for (const target of [
			"C:\\Users\\coder\\config",
			"C:/Users/coder/config",
			"\\\\server\\share\\config",
		]) {
			expect(isFullyQualifiedWindowsPath(target)).toBe(true);
		}
		for (const target of ["\\config", "C:config", "config", "C:\\*.conf"]) {
			expect(isFullyQualifiedWindowsPath(target)).toBe(false);
		}
	});

	it("parses only the SID field from whoami CSV output", () => {
		expect(parseWhoamiUserSid(`"account","${sid}"`)).toBe(sid);
		expect(parseWhoamiUserSid('"account","S-1-invalid"')).toBeUndefined();
		expect(parseWhoamiUserSid(`"account","${sid}","extra"`)).toBeUndefined();
	});

	it("reads exactly one matching backup entry", () => {
		expect(
			readSavedAclDescriptor(
				"C:\\Users\\coder\\config",
				`\uFEFFconfig\r\n${protectedAcl()}\r\n`,
			),
		).toBe(protectedAcl());
		for (const saved of [
			"other\r\nD:P",
			"config\r\n",
			"config\r\nD:P\r\nextra",
		]) {
			expect(() => readSavedAclDescriptor("C:\\config", saved)).toThrow(
				"Unexpected Windows ACL backup format",
			);
		}
	});

	it("accepts protected full-control permissions and documented SACL controls", () => {
		for (const suffix of ["", "S:AI", "S:PAIAR"]) {
			expect(hasCanonicalExpectedFileAcl(protectedAcl(sid, suffix), sid)).toBe(
				true,
			);
		}
	});

	it.each([
		["S-1-5-18", "SY", true],
		["S-1-5-19", "LS", true],
		["S-1-5-20", "NS", true],
		["S-1-5-21-1-2-3-500", "LA", true],
		["S-1-5-21-1-2-3-501", "LG", true],
		[sid, "LA", false],
		["S-1-5-21-1-2-3-500", "S-1-5-21-9-8-7-500", false],
		["S-1-5-21-1-2-3-501", "S-1-5-21-9-8-7-501", false],
	])("checks account %s against trustee %s", (account, trustee, expected) => {
		expect(hasCanonicalExpectedFileAcl(protectedAcl(trustee), account)).toBe(
			expected,
		);
	});

	it("rejects invalid descriptors and extra identities", () => {
		for (const descriptor of [
			`D:(A;;FA;;;${sid})(A;;FA;;;SY)(A;;FA;;;BA)`,
			protectedAcl(sid, "S:XYZ"),
			`D:P(A;;FA;;;${sid})(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;WD)`,
			`D:P(D;;FA;;;WD)(A;;FA;;;${sid})(A;;FA;;;SY)(A;;FA;;;BA)`,
			`D:P(A;OICI;FA;;;${sid})(A;;FA;;;SY)(A;;FA;;;BA)`,
			`D:P(A;;FA;;;SY)(A;;FA;;;SY)(A;;FA;;;BA)`,
		]) {
			expect(hasCanonicalExpectedFileAcl(descriptor, sid)).toBe(false);
		}
	});
});
