interface AccessControlEntry {
	Trustee: string;
	AccessMask: number;
	AceType: number;
	AceFlags: number;
}

interface AccessControlList {
	AclRevision: number;
	AddAce(accessControlEntry: AccessControlEntry): void;
}

interface SecurityDescriptor {
	DiscretionaryAcl: AccessControlList;
}

interface ADsSecurityUtility {
	SecurityMask: number;
	GetSecurityDescriptor(
		path: string,
		pathType: number,
		format: number,
	): SecurityDescriptor;
	SetSecurityDescriptor(
		path: string,
		pathType: number,
		securityDescriptor: SecurityDescriptor,
		format: number,
	): void;
}

interface ActiveXObjectConstructor {
	new (programId: "ADsSecurityUtility"): ADsSecurityUtility;
	new (programId: "AccessControlList"): AccessControlList;
	new (programId: "AccessControlEntry"): AccessControlEntry;
}

declare var ActiveXObject: ActiveXObjectConstructor;

interface WScriptArguments {
	length: number;
	Item(index: number): string;
}

interface WScriptHost {
	Arguments: WScriptArguments;
	StdErr: {
		WriteLine(message: string): void;
	};
	Quit(exitCode: number): void;
}

declare var WScript: WScriptHost;
