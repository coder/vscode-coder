import * as path from "node:path";

const sddlAcePattern = /^\(A;;FA;;;([A-Z]{2}|S-\d+(?:-\d+)+)\)$/;
const sddlAceListPattern = /\(A;;FA;;;(?:[A-Z]{2}|S-\d+(?:-\d+)+)\)/g;
const sddlDaclPattern = /^D:([A-Z]*)(.*)$/;
const whoamiCsvSidPattern = /,"(S-\d+(?:-\d+)+)"\s*$/;

// https://learn.microsoft.com/windows/win32/secauthz/security-descriptor-string-format
// P, AI, and AR are the documented DACL and SACL control flags.
function hasControlFlags(flags: string, protectedDacl = false): boolean {
	if (flags === "") return !protectedDacl;
	const controls = flags.match(/P|AI|AR/g);
	return (
		controls?.join("") === flags &&
		new Set(controls).size === controls.length &&
		(protectedDacl ? controls.includes("P") : true)
	);
}

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
	const saclIndex = descriptor.indexOf("S:", 2);
	const dacl = saclIndex === -1 ? descriptor : descriptor.slice(0, saclIndex);
	const sacl = saclIndex === -1 ? undefined : descriptor.slice(saclIndex + 2);
	const daclMatch = sddlDaclPattern.exec(dacl);
	if (
		!daclMatch ||
		!hasControlFlags(daclMatch[1], true) ||
		(sacl !== undefined && !hasControlFlags(sacl))
	) {
		return false;
	}

	const aces = daclMatch[2].match(sddlAceListPattern);
	if (aces?.join("") !== daclMatch[2] || aces.length !== 3) return false;

	const trustees: string[] = [];
	for (const ace of aces) {
		const trustee = sddlAcePattern.exec(ace)?.[1];
		if (!trustee) return false;
		trustees.push(canonicalTrustee(trustee, currentUserSid));
	}
	const expected = [
		canonicalTrustee(currentUserSid, currentUserSid),
		"SY",
		"BA",
	].sort();
	return trustees.sort().join("\0") === expected.join("\0");
}
