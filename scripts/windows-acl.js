// Windows Script Host runs JScript, which requires ES3 syntax.
// https://learn.microsoft.com/en-us/windows/win32/api/iads/ne-iads-ads_pathtype_enum
var ADS_PATH_FILE = 1;
// https://learn.microsoft.com/en-us/windows/win32/api/iads/ne-iads-ads_sd_format_enum
var ADS_SD_FORMAT_IID = 1;
// https://learn.microsoft.com/en-us/windows/win32/api/iads/ne-iads-ads_security_info_enum
var ADS_SECURITY_INFO_DACL = 4;
// https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-acl
var ACL_REVISION = 2;
// https://learn.microsoft.com/en-us/windows/win32/fileio/file-access-rights-constants
var FILE_ALL_ACCESS = 0x1f01ff;

/**
 * @param {unknown} error
 * @returns {error is { description?: unknown, message?: unknown }}
 */
function isComError(error) {
	return typeof error === "object" && error !== null;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
	if (isComError(error)) {
		if (typeof error.description === "string") {
			return error.description;
		}
		if (typeof error.message === "string") {
			return error.message;
		}
	}
	if (typeof error === "string") {
		return error;
	}
	return "Unknown error";
}

try {
	if (WScript.Arguments.length !== 2) {
		throw new Error("Expected a file path and user SID");
	}
	var target = WScript.Arguments.Item(0);
	var sid = WScript.Arguments.Item(1);
	// https://learn.microsoft.com/en-us/windows/win32/secauthz/sid-components
	if (!/^S-\d+(?:-\d+)+$/.test(sid)) {
		throw new Error("Invalid Windows user SID");
	}

	// https://learn.microsoft.com/en-us/windows/win32/api/iads/nn-iads-iadssecurityutility
	var security = new ActiveXObject("ADsSecurityUtility");
	security.SecurityMask = ADS_SECURITY_INFO_DACL;
	var descriptor = security.GetSecurityDescriptor(
		target,
		ADS_PATH_FILE,
		ADS_SD_FORMAT_IID
	);
	var dacl = new ActiveXObject("AccessControlList");
	dacl.AclRevision = ACL_REVISION;
	// https://learn.microsoft.com/en-us/windows/win32/secauthz/well-known-sids
	var trustees = [sid, "S-1-5-18", "S-1-5-32-544"];
	for (var index = 0; index < trustees.length; index++) {
		var ace = new ActiveXObject("AccessControlEntry");
		ace.Trustee = trustees[index];
		ace.AccessMask = FILE_ALL_ACCESS;
		// https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-ace_header
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
	WScript.StdErr.WriteLine("Windows ACL repair failed: " + errorMessage(error));
	WScript.Quit(1);
}
