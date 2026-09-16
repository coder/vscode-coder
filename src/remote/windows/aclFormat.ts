import * as path from "node:path";

/**
 * Protected DACL with three allow/full-control ACEs. Tested icacls backups can
 * include inheritance control flags and an empty SACL, but no audit entries.
 * @see https://learn.microsoft.com/windows/win32/secauthz/security-descriptor-string-format
 * @see https://learn.microsoft.com/windows/win32/secauthz/ace-strings
 */
const DESCRIPTOR_PATTERN =
	/^D:P(?:AI)?(?:AR)?((?:\(A;;FA;;;[A-Z0-9-]+\)){3})(?:S:P?(?:AI)?(?:AR)?)?$/;
/** Capture each trustee from an allow/full-control ACE. */
const TRUSTEE_PATTERN = /\(A;;FA;;;([A-Z0-9-]+)\)/g;
/** Capture the final quoted SID column in whoami CSV output. */
const WHOAMI_CSV_SID_PATTERN = /,"(S-\d+(?:-\d+)+)"\s*$/;
/** Reject NUL, line breaks, and wildcards in single-file commands. */
const INVALID_PATH_CHARACTERS_PATTERN = /[\0\r\n*?]/;
const DRIVE_ROOT_PATTERN = /^[A-Za-z]:\\/;
/** Require both a server and share in a UNC root. */
const UNC_ROOT_PATTERN = /^\\\\[^\\]+\\[^\\]+(?:\\|$)/;
/** Match account SIDs ending in the Administrator RID, 500. */
const ADMINISTRATOR_SID_PATTERN = /^S-1-5-21-\d+-\d+-\d+-500$/;
/** Match account SIDs ending in the Guest RID, 501. */
const GUEST_SID_PATTERN = /^S-1-5-21-\d+-\d+-\d+-501$/;

/** Read the SID column, not the localized account name, from whoami CSV output. */
export function parseWhoamiUserSid(csv: string): string | undefined {
	return WHOAMI_CSV_SID_PATTERN.exec(csv)?.[1];
}

/** Accept drive-qualified or UNC paths suitable for a single-file ACL command. */
export function isFullyQualifiedWindowsPath(target: string): boolean {
	if (INVALID_PATH_CHARACTERS_PATTERN.test(target)) return false;
	target = path.win32.normalize(target);
	return DRIVE_ROOT_PATTERN.test(target) || UNC_ROOT_PATTERN.test(target);
}

/** Read a single-file icacls backup and check that it names the requested file. */
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

/** Verify only the current user, SYSTEM, and Administrators have full control. */
export function hasCanonicalExpectedFileAcl(
	descriptor: string,
	currentUserSid: string,
): boolean {
	const aces = DESCRIPTOR_PATTERN.exec(descriptor)?.[1];
	if (!aces) return false;
	const trustees = [...aces.matchAll(TRUSTEE_PATTERN)].map((ace) =>
		canonicalTrustee(ace[1], currentUserSid),
	);
	const expected = [
		canonicalTrustee(currentUserSid, currentUserSid),
		"SY",
		"BA",
	];
	return trustees.sort().join("\0") === expected.sort().join("\0");
}

/**
 * Normalize numeric SIDs and the aliases emitted by icacls for comparison.
 * Local Administrator/Guest aliases count only for the current user's RID.
 * @see https://learn.microsoft.com/windows/win32/secauthz/well-known-sids
 */
function canonicalTrustee(trustee: string, currentUserSid: string): string {
	if (trustee === "S-1-5-18") return "SY";
	if (trustee === "S-1-5-32-544") return "BA";
	if (trustee === "LA" && ADMINISTRATOR_SID_PATTERN.test(currentUserSid)) {
		return currentUserSid;
	}
	if (trustee === "LG" && GUEST_SID_PATTERN.test(currentUserSid)) {
		return currentUserSid;
	}
	return trustee;
}
