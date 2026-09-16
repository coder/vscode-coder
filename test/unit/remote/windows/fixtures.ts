/** Arbitrary, but the RID must not be 500 or 501; those have icacls aliases. */
export const SID = "S-1-5-21-1-2-3-1001";
export const EXTENSION_PATH = "C:\\Program Files\\Coder";

/** The descriptor icacls saves for a correctly protected file. */
export function protectedAcl(user = SID, suffix = ""): string {
	return `D:PAI(A;;FA;;;${user})(A;;FA;;;SY)(A;;FA;;;BA)${suffix}`;
}

/** `whoami /user /fo csv /nh` output, whose last column is the SID. */
export function whoamiCsv(sid = SID): string {
	return `"account","${sid}"`;
}
