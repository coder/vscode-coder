/** Globals provided by Windows Script Host, not by Node.js. */
declare var WScript: WScriptHost;
/** Construct only the ADSI Automation objects used by the ACL setter. */
declare var ActiveXObject: ActiveXObjectConstructor;

interface WScriptHost {
	/** Positional command-line arguments after the script path. */
	Arguments: {
		length: number;
		Item(index: number): string;
	};
	/** Diagnostic output captured by the extension. */
	StdErr: {
		WriteLine(message: string): void;
	};
	Quit(exitCode: number): void;
}

interface ActiveXObjectConstructor {
	new (programId: "ADsSecurityUtility"): ADsSecurityUtility;
	new (programId: "AccessControlList"): AccessControlList;
	new (programId: "AccessControlEntry"): AccessControlEntry;
}

interface ADsSecurityUtility {
	/** Select which security descriptor sections to read and write. */
	SecurityMask: number;
	GetSecurityDescriptor(
		path: string,
		pathType: number,
		format: number,
	): SecurityDescriptor;
	/** Persist only the sections selected by SecurityMask. */
	SetSecurityDescriptor(
		path: string,
		pathType: number,
		securityDescriptor: SecurityDescriptor,
		format: number,
	): void;
}

interface SecurityDescriptor {
	/** File access rules, separate from ownership and audit settings. */
	DiscretionaryAcl: AccessControlList;
}

interface AccessControlList {
	/** Set to 2 for ordinary file ACEs. */
	AclRevision: number;
	AddAce(accessControlEntry: AccessControlEntry): void;
}

interface AccessControlEntry {
	/** SID or account name receiving this rule. */
	Trustee: string;
	AccessMask: number;
	/** 0 is access allowed. */
	AceType: number;
	/** 0 limits the rule to this file. */
	AceFlags: number;
}
