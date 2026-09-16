/** Windows Script Host runs this source directly using ES3-compatible JScript. */
/**
 * Treat the target as a filesystem path, not a registry key or share.
 * @see https://learn.microsoft.com/en-us/windows/win32/api/iads/ne-iads-ads_pathtype_enum
 */
var ADS_PATH_FILE = 1;
/**
 * Use the ADSI descriptor object so its DACL can be replaced.
 * @see https://learn.microsoft.com/en-us/windows/win32/api/iads/ne-iads-ads_sd_format_enum
 */
var ADS_SD_FORMAT_IID = 1;
/**
 * Read and write only the DACL, preserving ownership and audit settings.
 * @see https://learn.microsoft.com/en-us/windows/win32/api/iads/ne-iads-ads_security_info_enum
 */
var ADS_SECURITY_INFO_DACL = 4;
/**
 * Revision 2 supports the ordinary, non-object ACEs used for this file.
 * @see https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-acl
 */
var ACL_REVISION = 2;
/**
 * Grant full file access to the three permitted trustees.
 * @see https://learn.microsoft.com/en-us/windows/win32/fileio/file-access-rights-constants
 */
var FILE_ALL_ACCESS = 0x1f01ff;
/**
 * Numeric SID syntax avoids localized account-name resolution.
 * @see https://learn.microsoft.com/en-us/windows/win32/secauthz/sid-components
 */
var USER_SID_PATTERN = /^S-\d+(?:-\d+)+$/;

try {
	if (WScript.Arguments.length !== 2) {
		throw new Error("Expected a file path and user SID");
	}
	var target = WScript.Arguments.Item(0);
	var sid = WScript.Arguments.Item(1);
	if (!USER_SID_PATTERN.test(sid)) {
		throw new Error("Invalid Windows user SID");
	}

	// Replace the file DACL through built-in ADSI without changing its owner.
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
	// Permit the current user, SYSTEM, and the local Administrators group.
	// https://learn.microsoft.com/en-us/windows/win32/secauthz/well-known-sids
	var trustees = [sid, "S-1-5-18", "S-1-5-32-544"];
	// Keep indexed iteration: this source is not transpiled, and ES3 has no for...of.
	for (var index = 0; index < trustees.length; index++) {
		var ace = new ActiveXObject("AccessControlEntry");
		ace.Trustee = trustees[index];
		ace.AccessMask = FILE_ALL_ACCESS;
		// An allow ACE with no inheritance flags applies only to this file.
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
	/**
	 * Automation errors carry `description` rather than `message`.
	 * @see https://learn.microsoft.com/en-us/openspecs/ie_standards/ms-es3ex/a4f75a6b-dda5-40e1-85d0-9f95afb24fba
	 * @type {any}
	 */
	var thrown = error;
	WScript.StdErr.WriteLine(
		"Windows ACL repair failed: " +
			((thrown && (thrown.message || thrown.description)) || thrown)
	);
	WScript.Quit(1);
}
