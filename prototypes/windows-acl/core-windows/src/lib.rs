//! Narrow Windows ACL prototype core using the `windows` projection.

/// Applies the prototype protected DACL to an existing absolute path.
///
/// On Windows, the final object must not be a reparse point and must be owned by
/// the current user, LocalSystem, or the built-in Administrators group.
#[cfg(windows)]
pub fn secure_path(path: &std::path::Path) -> std::io::Result<()> {
    windows::secure_path(path)
}

/// Returns the protected DACL as an SDDL string.
#[cfg(windows)]
pub fn inspect_path(path: &std::path::Path) -> std::io::Result<String> {
    windows::inspect_path(path)
}

/// Identifies the platform implementation.
#[cfg(windows)]
pub fn backend() -> &'static str {
    "windows"
}

/// This prototype has no non-Windows permission emulation.
#[cfg(not(windows))]
pub fn secure_path(_path: &std::path::Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Windows ACL protection is unsupported on this platform",
    ))
}

/// This prototype has no non-Windows security descriptor inspection.
#[cfg(not(windows))]
pub fn inspect_path(_path: &std::path::Path) -> std::io::Result<String> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Windows ACL inspection is unsupported on this platform",
    ))
}

/// Identifies the unsupported implementation.
#[cfg(not(windows))]
pub fn backend() -> &'static str {
    "unsupported"
}

#[cfg(windows)]
mod windows {
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::path::Path;
    use std::ptr::null_mut;
    use windows::Win32::Foundation::{HANDLE, HLOCAL, LocalFree, WIN32_ERROR};
    use windows::Win32::Security::Authorization::{
        ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertSidToStringSidW,
        ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SE_FILE_OBJECT,
        SetSecurityInfo,
    };
    use windows::Win32::Security::{
        ACL, CopySid, DACL_SECURITY_INFORMATION, EqualSid, GROUP_SECURITY_INFORMATION,
        GetLengthSid, GetSecurityDescriptorDacl, GetSecurityDescriptorOwner, GetTokenInformation,
        IsValidSid, IsWellKnownSid, OWNER_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, TOKEN_QUERY, TOKEN_USER,
        TokenUser, WinBuiltinAdministratorsSid, WinLocalSystemSid,
    };
    use windows::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileInformationByHandle, READ_CONTROL, WRITE_DAC,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    use windows::core::{PCWSTR, PWSTR};

    const SDDL_REVISION_1: u32 = 1;

    pub fn secure_path(path: &Path) -> io::Result<()> {
        let file = open(path, (READ_CONTROL | WRITE_DAC).0)?;
        let facts = facts(&file)?;
        reject_reparse(facts.dwFileAttributes)?;

        let user = current_user_sid()?;
        let existing = SecurityDescriptor::get(&file)?;
        validate_owner(existing.owner()?, user.as_psid())?;

        let inheritance = if facts.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY.0 != 0 {
            "OICI"
        } else {
            ""
        };
        let sddl = format!(
            "D:P(A;{inheritance};FA;;;{})(A;{inheritance};FA;;;SY)(A;{inheritance};FA;;;BA)",
            user.to_sddl()?
        );
        let protected = SecurityDescriptor::from_sddl(&sddl)?;
        let dacl = protected.dacl()?;

        check(unsafe {
            SetSecurityInfo(
                HANDLE(file.as_raw_handle()),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                None,
                None,
                Some(dacl),
                None,
            )
        })
    }

    pub fn inspect_path(path: &Path) -> io::Result<String> {
        let file = open(path, READ_CONTROL.0)?;
        SecurityDescriptor::get(&file)?.to_sddl()
    }

    fn open(path: &Path, access: u32) -> io::Result<File> {
        if !path.is_absolute() {
            return Err(invalid_input("path must be absolute"));
        }
        OpenOptions::new()
            .access_mode(access)
            .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE).0)
            .custom_flags((FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT).0)
            .open(path)
    }

    fn facts(file: &File) -> io::Result<BY_HANDLE_FILE_INFORMATION> {
        let mut facts = BY_HANDLE_FILE_INFORMATION::default();
        unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut facts) }
            .map_err(windows_error)?;
        Ok(facts)
    }

    fn reject_reparse(attributes: u32) -> io::Result<()> {
        if attributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
            Err(invalid_input(
                "final path component must not be a reparse point",
            ))
        } else {
            Ok(())
        }
    }

    struct Token(OwnedHandle);

    impl Token {
        fn current_process() -> io::Result<Self> {
            let mut handle = HANDLE::default();
            unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) }
                .map_err(windows_error)?;
            Ok(Self(unsafe { OwnedHandle::from_raw_handle(handle.0) }))
        }
    }

    struct Sid(Vec<usize>);

    impl Sid {
        fn as_psid(&self) -> PSID {
            PSID(self.0.as_ptr().cast_mut().cast())
        }

        fn to_sddl(&self) -> io::Result<String> {
            let mut value = PWSTR::null();
            unsafe { ConvertSidToStringSidW(self.as_psid(), &mut value) }.map_err(windows_error)?;
            if value.0.is_null() {
                return Err(io::Error::last_os_error());
            }
            let result = unsafe { value.to_string() }
                .map_err(|_| invalid_input("Windows returned invalid SID text"));
            unsafe { LocalFree(Some(HLOCAL(value.0.cast()))) };
            result
        }
    }

    fn current_user_sid() -> io::Result<Sid> {
        let token = Token::current_process()?;
        let mut length = 0;
        let _ = unsafe {
            GetTokenInformation(
                HANDLE(token.0.as_raw_handle()),
                TokenUser,
                None,
                0,
                &mut length,
            )
        };
        if length == 0 {
            return Err(io::Error::last_os_error());
        }

        let mut storage = vec![0usize; (length as usize).div_ceil(std::mem::size_of::<usize>())];
        unsafe {
            GetTokenInformation(
                HANDLE(token.0.as_raw_handle()),
                TokenUser,
                Some(storage.as_mut_ptr().cast()),
                length,
                &mut length,
            )
            .map_err(windows_error)?;
            let source = (*storage.as_ptr().cast::<TOKEN_USER>()).User.Sid;
            if source.0.is_null() || !IsValidSid(source).as_bool() {
                return Err(invalid_input(
                    "current process token contains an invalid user SID",
                ));
            }
            let bytes = GetLengthSid(source) as usize;
            let mut sid = vec![0usize; bytes.div_ceil(std::mem::size_of::<usize>())];
            CopySid(
                (sid.len() * std::mem::size_of::<usize>()) as u32,
                PSID(sid.as_mut_ptr().cast()),
                source,
            )
            .map_err(windows_error)?;
            Ok(Sid(sid))
        }
    }

    struct SecurityDescriptor(PSECURITY_DESCRIPTOR);

    impl SecurityDescriptor {
        fn get(file: &File) -> io::Result<Self> {
            let mut descriptor = PSECURITY_DESCRIPTOR::default();
            check(unsafe {
                GetSecurityInfo(
                    HANDLE(file.as_raw_handle()),
                    SE_FILE_OBJECT,
                    OWNER_SECURITY_INFORMATION
                        | GROUP_SECURITY_INFORMATION
                        | DACL_SECURITY_INFORMATION,
                    None,
                    None,
                    None,
                    None,
                    Some(&mut descriptor),
                )
            })?;
            Ok(Self(descriptor))
        }

        fn from_sddl(sddl: &str) -> io::Result<Self> {
            let value: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
            let mut descriptor = PSECURITY_DESCRIPTOR::default();
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    PCWSTR(value.as_ptr()),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    None,
                )
            }
            .map_err(windows_error)?;
            Ok(Self(descriptor))
        }

        fn owner(&self) -> io::Result<PSID> {
            let mut owner = PSID::default();
            let mut defaulted = false.into();
            unsafe { GetSecurityDescriptorOwner(self.0, &mut owner, &mut defaulted) }
                .map_err(windows_error)?;
            if owner.0.is_null() || !unsafe { IsValidSid(owner).as_bool() } {
                Err(invalid_input(
                    "path security descriptor has an invalid owner",
                ))
            } else {
                Ok(owner)
            }
        }

        fn dacl(&self) -> io::Result<&ACL> {
            let mut present = false.into();
            let mut dacl = null_mut();
            let mut defaulted = false.into();
            unsafe { GetSecurityDescriptorDacl(self.0, &mut present, &mut dacl, &mut defaulted) }
                .map_err(windows_error)?;
            if !present.as_bool() || dacl.is_null() {
                return Err(invalid_input(
                    "security descriptor must contain a non-null DACL",
                ));
            }
            Ok(unsafe { &*dacl })
        }

        fn to_sddl(&self) -> io::Result<String> {
            let mut value = PWSTR::null();
            let mut length = 0;
            unsafe {
                ConvertSecurityDescriptorToStringSecurityDescriptorW(
                    self.0,
                    SDDL_REVISION_1,
                    DACL_SECURITY_INFORMATION,
                    &mut value,
                    Some(&mut length),
                )
            }
            .map_err(windows_error)?;
            if value.0.is_null() {
                return Err(io::Error::last_os_error());
            }
            let result = unsafe { value.to_string() }
                .map_err(|_| invalid_input("Windows returned invalid SDDL"));
            unsafe { LocalFree(Some(HLOCAL(value.0.cast()))) };
            result
        }
    }

    impl Drop for SecurityDescriptor {
        fn drop(&mut self) {
            unsafe { LocalFree(Some(HLOCAL(self.0.0.cast()))) };
        }
    }

    fn validate_owner(owner: PSID, current_user: PSID) -> io::Result<()> {
        let trusted = unsafe {
            // The generated projection maps EqualSid's false BOOL result to an error.
            EqualSid(owner, current_user).is_ok()
                || IsWellKnownSid(owner, WinLocalSystemSid).as_bool()
                || IsWellKnownSid(owner, WinBuiltinAdministratorsSid).as_bool()
        };
        if trusted {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "path owner is not the current user, LocalSystem, or Administrators",
            ))
        }
    }

    fn check(result: WIN32_ERROR) -> io::Result<()> {
        if result.is_ok() {
            Ok(())
        } else {
            Err(io::Error::from_raw_os_error(result.0 as i32))
        }
    }

    fn windows_error(error: windows::core::Error) -> io::Error {
        let code = error.code().0 as u32;
        if (code >> 16) & 0x1fff == 7 {
            io::Error::from_raw_os_error((code & 0xffff) as i32)
        } else {
            io::Error::other(error.message())
        }
    }

    fn invalid_input(message: &'static str) -> io::Error {
        io::Error::new(io::ErrorKind::InvalidInput, message)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::fs;

        #[test]
        fn secure_path_applies_an_idempotent_protected_dacl() {
            let path = std::env::temp_dir().join(format!(
                "acl-prototype-windows-{}-{}.conf",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
            ));
            fs::write(&path, "Host acl-prototype\n").unwrap();

            secure_path(&path).unwrap();
            let first = inspect_path(&path).unwrap();
            secure_path(&path).unwrap();
            let second = inspect_path(&path).unwrap();

            assert!(first.contains("D:P"), "DACL must be protected: {first}");
            assert_eq!(second, first, "secure_path must be idempotent");
            fs::remove_file(path).unwrap();
        }
    }
}
