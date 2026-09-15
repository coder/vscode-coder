/* global WScript, ActiveXObject */

// Windows Script Host runs JScript, which requires ES3 syntax.
var ADS_PATH_FILE = 1;
var ADS_SD_FORMAT_IID = 1;
var ADS_SECURITY_INFO_DACL = 4;
var ACL_REVISION = 2;
var FILE_ALL_ACCESS = 0x1f01ff;

try {
	if (WScript.Arguments.length !== 2) {
		throw new Error("Expected a file path and user SID");
	}
	var target = WScript.Arguments.Item(0);
	var sid = WScript.Arguments.Item(1);
	if (!/^S-\d+(?:-\d+)+$/.test(sid)) {
		throw new Error("Invalid Windows user SID");
	}

	var security = new ActiveXObject("ADsSecurityUtility");
	security.SecurityMask = ADS_SECURITY_INFO_DACL;
	var descriptor = security.GetSecurityDescriptor(
		target,
		ADS_PATH_FILE,
		ADS_SD_FORMAT_IID
	);
	var dacl = new ActiveXObject("AccessControlList");
	dacl.AclRevision = ACL_REVISION;
	var trustees = [sid, "S-1-5-18", "S-1-5-32-544"];
	for (var index = 0; index < trustees.length; index++) {
		var ace = new ActiveXObject("AccessControlEntry");
		ace.Trustee = trustees[index];
		ace.AccessMask = FILE_ALL_ACCESS;
		ace.AceType = 0;
		ace.AceFlags = 0;
		dacl.AddAce(ace);
	}
	descriptor.DiscretionaryAcl = dacl;
	security.SetSecurityDescriptor(
		target,
		ADS_PATH_FILE,
		descriptor,
		ADS_SD_FORMAT_IID
	);
} catch (error) {
	WScript.StdErr.WriteLine(
		"Windows ACL repair failed: " + (error.description || error.message)
	);
	WScript.Quit(1);
}
