import * as path from "node:path";

// DACL: protected, optionally auto-inherited/requested, exactly three allow/full-control ACEs.
// icacls /save can append SACL control flags without audit entries.
// https://learn.microsoft.com/windows/win32/secauthz/security-descriptor-string-format
// https://learn.microsoft.com/windows/win32/secauthz/ace-strings
const descriptorPattern =
	/^D:P(?:AI)?(?:AR)?((?:\(A;;FA;;;[A-Z0-9-]+\)){3})(?:S:P?(?:AI)?(?:AR)?)?$/;
const trusteePattern = /\(A;;FA;;;([A-Z0-9-]+)\)/g;
const whoamiCsvSidPattern = /,"(S-\d+(?:-\d+)+)"\s*$/;

// https://learn.microsoft.com/windows/win32/secauthz/well-known-sids
// SY, BA, LS, NS, LA, and LG are SDDL aliases for these well-known SIDs.
function localAccountAlias(sid: string): "LA" | "LG" | undefined {
	if (/^S-1-5-21-\d+-\d+-\d+-500$/.test(sid)) return "LA";
	if (/^S-1-5-21-\d+-\d+-\d+-501$/.test(sid)) return "LG";
	return undefined;
}

function canonicalTrustee(trustee: string, currentUserSid: string): string {
	if (trustee === "S-1-5-18") return "SY";
	if (trustee === "S-1-5-32-544") return "BA";
	if (trustee === "S-1-5-19") return "LS";
	if (trustee === "S-1-5-20") return "NS";
	if (trustee === localAccountAlias(currentUserSid)) return currentUserSid;
	return trustee;
}

export function parseWhoamiUserSid(csv: string): string | undefined {
	return whoamiCsvSidPattern.exec(csv)?.[1];
}

export function isFullyQualifiedWindowsPath(target: string): boolean {
	if (/[\0\r\n*?]/.test(target)) return false;
	target = path.win32.normalize(target);
	return (
		/^[A-Za-z]:\\/.test(target) || /^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(target)
	);
}

export function readSavedAclDescriptor(target: string, saved: string): string {
	const [name, descriptor, ...extra] = saved
		.replace(/^\uFEFF/, "")
		.trimEnd()
		.split(/\r?\n/);
	if (
		name !== path.win32.basename(target) ||
		extra.length !== 0 ||
		!descriptor
	) {
		throw new Error("Unexpected Windows ACL backup format");
	}
	return descriptor;
}

export function hasCanonicalExpectedFileAcl(
	descriptor: string,
	currentUserSid: string,
): boolean {
	const aces = descriptorPattern.exec(descriptor)?.[1];
	if (!aces) return false;
	const trustees = [...aces.matchAll(trusteePattern)].map((ace) =>
		canonicalTrustee(ace[1], currentUserSid),
	);
	const expected = [
		canonicalTrustee(currentUserSid, currentUserSid),
		"SY",
		"BA",
	];
	return trustees.sort().join("\0") === expected.sort().join("\0");
}
