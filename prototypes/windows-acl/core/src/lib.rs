//! Narrow Windows ACL prototype core.
//!
//! This crate intentionally protects only the final path component. It does not
//! validate parent directories. Opening and inspecting the final object by handle
//! closes the lookup-to-mutation race for that object, but a concurrent actor can
//! still replace the path after the operation. Do not use it as production hardening.

use std::io;
use std::path::Path;

/// Applies the prototype protected DACL to an existing absolute path.
///
/// On Windows, the final object must not be a reparse point and must be owned by
/// the current user, LocalSystem, or the built-in Administrators group.
#[cfg(windows)]
pub fn secure_path(path: &Path) -> io::Result<()> {
    windows::secure_path(path)
}

/// Returns the protected DACL as an SDDL string.
#[cfg(windows)]
pub fn inspect_path(path: &Path) -> io::Result<String> {
    windows::inspect_path(path)
}

/// Identifies the platform implementation.
#[cfg(windows)]
pub fn backend() -> &'static str {
    "windows-sys"
}

/// This prototype has no non-Windows permission emulation.
#[cfg(not(windows))]
pub fn secure_path(_path: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Windows ACL protection is unsupported on this platform",
    ))
}

/// This prototype has no non-Windows security descriptor inspection.
#[cfg(not(windows))]
pub fn inspect_path(_path: &Path) -> io::Result<String> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
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
    use std::ffi::OsString;
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{HANDLE, LocalFree};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertSidToStringSidW,
        ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SE_FILE_OBJECT,
        SetSecurityInfo,
    };
    use windows_sys::Win32::Security::{
        DACL_SECURITY_INFORMATION, EqualSid, GROUP_SECURITY_INFORMATION, GetLengthSid,
        GetSecurityDescriptorDacl, GetSecurityDescriptorOwner, GetTokenInformation, IsValidSid,
        OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, TOKEN_QUERY, TOKEN_USER, TokenUser,
        WinBuiltinAdministratorsSid, WinLocalSystemSid,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileInformationByHandle, READ_CONTROL, WRITE_DAC,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    const PROTECTED_DACL_SECURITY_INFORMATION: u32 = 0x8000_0000;
    const SDDL_REVISION_1: u32 = 1;

    pub fn secure_path(path: &Path) -> io::Result<()> {
        let handle = open_path(path, READ_CONTROL | WRITE_DAC)?;
        let attributes = attributes(&handle)?;
        reject_reparse_point(attributes)?;

        let current_user = SidBuffer::current_user()?;
        let system = SidBuffer::well_known(WinLocalSystemSid)?;
        let administrators = SidBuffer::well_known(WinBuiltinAdministratorsSid)?;
        let descriptor = SecurityDescriptor::get(handle.as_raw_handle().cast())?;
        validate_owner(
            descriptor.owner()?,
            [&current_user, &system, &administrators],
        )?;

        let inheritance = if attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
            "OICI"
        } else {
            ""
        };
        let sddl = format!(
            "D:P(A;{inheritance};FA;;;{})(A;{inheritance};FA;;;SY)(A;{inheritance};FA;;;BA)",
            current_user.to_sddl()?
        );
        let protected_descriptor = SecurityDescriptor::from_sddl(&sddl)?;
        unsafe {
            check(SetSecurityInfo(
                handle.as_raw_handle().cast(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                protected_descriptor.dacl()? as *const _,
                null(),
            ))
        }
    }

    pub fn inspect_path(path: &Path) -> io::Result<String> {
        let handle = open_path(path, READ_CONTROL)?;
        SecurityDescriptor::get(handle.as_raw_handle().cast())?.to_sddl()
    }

    fn open_path(path: &Path, access_mode: u32) -> io::Result<File> {
        if !path.is_absolute() {
            return Err(invalid_input("path must be absolute"));
        }
        OpenOptions::new()
            .access_mode(access_mode)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
    }

    fn attributes(file: &File) -> io::Result<u32> {
        let mut information = BY_HANDLE_FILE_INFORMATION::default();
        unsafe {
            check_bool(GetFileInformationByHandle(
                file.as_raw_handle().cast(),
                &mut information,
            ))?
        };
        Ok(information.dwFileAttributes)
    }

    fn owned_handle(handle: HANDLE) -> OwnedHandle {
        // CreateFileW and OpenProcessToken return CloseHandle-owned handles.
        unsafe { OwnedHandle::from_raw_handle(handle.cast::<()>() as RawHandle) }
    }

    struct TokenHandle(OwnedHandle);

    impl TokenHandle {
        fn current_process() -> io::Result<Self> {
            let mut token = null_mut();
            unsafe {
                check_bool(OpenProcessToken(
                    GetCurrentProcess(),
                    TOKEN_QUERY,
                    &mut token,
                ))?
            };
            if token.is_null() {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(owned_handle(token)))
        }

        fn raw(&self) -> HANDLE {
            self.0.as_raw_handle().cast()
        }
    }

    /// Stores copied SID bytes in usize elements so the buffer remains aligned.
    struct SidBuffer {
        storage: Vec<usize>,
    }

    impl SidBuffer {
        fn current_user() -> io::Result<Self> {
            let token = TokenHandle::current_process()?;
            let mut length = 0;
            unsafe { GetTokenInformation(token.raw(), TokenUser, null_mut(), 0, &mut length) };
            if length == 0 {
                return Err(io::Error::last_os_error());
            }

            let mut token_user = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
            unsafe {
                check_bool(GetTokenInformation(
                    token.raw(),
                    TokenUser,
                    token_user.as_mut_ptr().cast(),
                    length,
                    &mut length,
                ))?;

                let source_sid = (*token_user.as_ptr().cast::<TOKEN_USER>()).User.Sid;
                if source_sid.is_null() || IsValidSid(source_sid) == 0 {
                    return Err(invalid_input(
                        "current process token contains an invalid user SID",
                    ));
                }

                let sid = Self::with_byte_capacity(GetLengthSid(source_sid) as usize);
                check_bool(windows_sys::Win32::Security::CopySid(
                    (sid.storage.len() * size_of::<usize>()) as u32,
                    sid.as_psid(),
                    source_sid,
                ))?;
                Ok(sid)
            }
        }

        fn well_known(kind: i32) -> io::Result<Self> {
            let mut length = 0;
            unsafe {
                windows_sys::Win32::Security::CreateWellKnownSid(
                    kind,
                    null_mut(),
                    null_mut(),
                    &mut length,
                )
            };
            if length == 0 {
                return Err(io::Error::last_os_error());
            }

            let mut sid = Self::with_byte_capacity(length as usize);
            unsafe {
                check_bool(windows_sys::Win32::Security::CreateWellKnownSid(
                    kind,
                    null_mut(),
                    sid.storage.as_mut_ptr().cast(),
                    &mut length,
                ))?;
                if IsValidSid(sid.as_psid()) == 0 {
                    return Err(invalid_input("well-known SID API returned an invalid SID"));
                }
            }
            Ok(sid)
        }

        fn to_sddl(&self) -> io::Result<String> {
            let mut value = null_mut();
            unsafe {
                check_bool(ConvertSidToStringSidW(self.as_psid(), &mut value))?;
                if value.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let sddl = wide_c_string(value);
                LocalFree(value.cast());
                Ok(sddl)
            }
        }

        fn with_byte_capacity(bytes: usize) -> Self {
            Self {
                storage: vec![0usize; bytes.div_ceil(size_of::<usize>())],
            }
        }

        fn as_psid(&self) -> PSID {
            self.storage.as_ptr().cast_mut().cast()
        }
    }

    struct SecurityDescriptor(PSECURITY_DESCRIPTOR);

    impl SecurityDescriptor {
        fn from_sddl(sddl: &str) -> io::Result<Self> {
            let sddl: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
            let mut descriptor = null_mut();
            unsafe {
                check_bool(ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    null_mut(),
                ))?;
            }
            if descriptor.is_null() {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(descriptor))
        }

        fn get(handle: HANDLE) -> io::Result<Self> {
            let mut descriptor = null_mut();
            unsafe {
                check(GetSecurityInfo(
                    handle,
                    SE_FILE_OBJECT,
                    OWNER_SECURITY_INFORMATION
                        | GROUP_SECURITY_INFORMATION
                        | DACL_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    &mut descriptor,
                ))?;
            }
            if descriptor.is_null() {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(descriptor))
        }

        fn owner(&self) -> io::Result<PSID> {
            let mut owner = null_mut();
            let mut owner_defaulted = 0;
            unsafe {
                check_bool(GetSecurityDescriptorOwner(
                    self.0,
                    &mut owner,
                    &mut owner_defaulted,
                ))?
            };
            if owner.is_null() || unsafe { IsValidSid(owner) } == 0 {
                return Err(invalid_input(
                    "path security descriptor has an invalid owner",
                ));
            }
            Ok(owner)
        }

        fn dacl(&self) -> io::Result<&windows_sys::Win32::Security::ACL> {
            let mut present = 0;
            let mut dacl = null_mut();
            let mut defaulted = 0;
            unsafe {
                check_bool(GetSecurityDescriptorDacl(
                    self.0,
                    &mut present,
                    &mut dacl,
                    &mut defaulted,
                ))?
            };
            if present == 0 || dacl.is_null() {
                return Err(invalid_input(
                    "parsed protected SDDL must contain a non-null DACL",
                ));
            }
            Ok(unsafe { &*dacl })
        }

        fn to_sddl(&self) -> io::Result<String> {
            let mut value = null_mut();
            let mut length = 0;
            unsafe {
                check_bool(ConvertSecurityDescriptorToStringSecurityDescriptorW(
                    self.0,
                    SDDL_REVISION_1,
                    DACL_SECURITY_INFORMATION,
                    &mut value,
                    &mut length,
                ))?;
                if value.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let sddl = wide_c_string(value);
                LocalFree(value.cast());
                Ok(sddl)
            }
        }
    }

    impl Drop for SecurityDescriptor {
        fn drop(&mut self) {
            unsafe { LocalFree(self.0.cast()) };
        }
    }

    fn wide_c_string(value: *const u16) -> String {
        let mut length = 0;
        unsafe {
            while *value.add(length) != 0 {
                length += 1;
            }
            OsString::from_wide(std::slice::from_raw_parts(value, length))
                .to_string_lossy()
                .into_owned()
        }
    }

    fn validate_owner(owner: PSID, trusted_sids: [&SidBuffer; 3]) -> io::Result<()> {
        let trusted = unsafe {
            trusted_sids
                .into_iter()
                .any(|trusted_sid| EqualSid(owner, trusted_sid.as_psid()) != 0)
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

    fn reject_reparse_point(attributes: u32) -> io::Result<()> {
        if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            Err(invalid_input(
                "final path component must not be a reparse point",
            ))
        } else {
            Ok(())
        }
    }

    fn check(result: u32) -> io::Result<()> {
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::from_raw_os_error(result as i32))
        }
    }

    fn check_bool(result: i32) -> io::Result<()> {
        if result != 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    fn invalid_input(message: &'static str) -> io::Error {
        io::Error::new(io::ErrorKind::InvalidInput, message)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::fs;
        use std::ptr::null_mut;
        use windows_sys::Win32::Security::{
            ACCESS_ALLOWED_ACE, GetAce, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
            SE_DACL_PROTECTED,
        };
        use windows_sys::Win32::Storage::FileSystem::FILE_ALL_ACCESS;

        const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
        const OBJECT_INHERIT_ACE: u8 = 0x01;
        const CONTAINER_INHERIT_ACE: u8 = 0x02;
        const INHERITED_ACE: u8 = 0x10;

        fn temporary_path(name: &str) -> std::path::PathBuf {
            std::env::temp_dir().join(format!(
                "acl-prototype-{name}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
        }

        fn trusted_sids() -> (SidBuffer, SidBuffer, SidBuffer) {
            (
                SidBuffer::current_user().unwrap(),
                SidBuffer::well_known(WinLocalSystemSid).unwrap(),
                SidBuffer::well_known(WinBuiltinAdministratorsSid).unwrap(),
            )
        }

        fn assert_acl(
            path: &Path,
            expected_sids: [&SidBuffer; 3],
            expected_flags: u8,
            protected: bool,
        ) {
            let handle = open_path(path, READ_CONTROL).unwrap();
            let descriptor = SecurityDescriptor::get(handle.as_raw_handle().cast()).unwrap();
            let mut control = 0;
            let mut revision = 0;
            unsafe {
                check_bool(GetSecurityDescriptorControl(
                    descriptor.0,
                    &mut control,
                    &mut revision,
                ))
                .unwrap();
            }
            assert_eq!(
                control & SE_DACL_PROTECTED != 0,
                protected,
                "protected DACL state was unexpected for {}",
                path.display()
            );

            let mut dacl_present = 0;
            let mut dacl = null_mut();
            let mut dacl_defaulted = 0;
            unsafe {
                check_bool(GetSecurityDescriptorDacl(
                    descriptor.0,
                    &mut dacl_present,
                    &mut dacl,
                    &mut dacl_defaulted,
                ))
                .unwrap();
            }
            assert_ne!(dacl_present, 0, "security descriptor must contain a DACL");
            assert!(
                !dacl.is_null(),
                "security descriptor must contain a non-null DACL"
            );
            assert_eq!(
                unsafe { (*dacl).AceCount },
                3,
                "DACL must contain three ACEs"
            );

            for (index, expected_sid) in expected_sids.into_iter().enumerate() {
                let mut ace = null_mut();
                unsafe {
                    check_bool(GetAce(dacl, index as u32, &mut ace)).unwrap();
                    let ace = ace.cast::<ACCESS_ALLOWED_ACE>();
                    assert_eq!(
                        (*ace).Header.AceType,
                        ACCESS_ALLOWED_ACE_TYPE,
                        "ACE {index} must allow access",
                    );
                    assert_eq!(
                        (*ace).Header.AceFlags,
                        expected_flags,
                        "ACE {index} inheritance flags were unexpected",
                    );
                    assert_eq!(
                        (*ace).Mask,
                        FILE_ALL_ACCESS,
                        "ACE {index} must grant full control",
                    );
                    let sid = std::ptr::addr_of!((*ace).SidStart).cast_mut().cast();
                    assert_ne!(
                        EqualSid(sid, expected_sid.as_psid()),
                        0,
                        "ACE {index} SID did not match",
                    );
                }
            }
        }

        fn assert_inherited_child_acl(path: &Path, expected_sids: [&SidBuffer; 3]) {
            let handle = open_path(path, READ_CONTROL).unwrap();
            let descriptor = SecurityDescriptor::get(handle.as_raw_handle().cast()).unwrap();
            let dacl = descriptor.dacl().unwrap();
            assert_eq!(dacl.AceCount, 3, "child DACL must inherit three ACEs");

            for (index, expected_sid) in expected_sids.into_iter().enumerate() {
                let mut ace = null_mut();
                unsafe {
                    check_bool(GetAce(dacl as *const _ as *mut _, index as u32, &mut ace)).unwrap();
                    let ace = ace.cast::<ACCESS_ALLOWED_ACE>();
                    assert_ne!(
                        (*ace).Header.AceFlags & INHERITED_ACE,
                        0,
                        "child ACE {index} must be inherited",
                    );
                    assert_eq!(
                        (*ace).Mask,
                        FILE_ALL_ACCESS,
                        "child ACE {index} must grant full control",
                    );
                    let sid = std::ptr::addr_of!((*ace).SidStart).cast_mut().cast();
                    assert_ne!(
                        EqualSid(sid, expected_sid.as_psid()),
                        0,
                        "child ACE {index} SID did not match",
                    );
                }
            }
        }

        #[test]
        fn validate_owner_accepts_trusted_sids_and_rejects_world() {
            let (current_user, system, administrators) = trusted_sids();
            let trusted = [&current_user, &system, &administrators];
            for owner in trusted {
                validate_owner(owner.as_psid(), trusted).unwrap();
            }

            let world = SidBuffer::well_known(windows_sys::Win32::Security::WinWorldSid).unwrap();
            assert_eq!(
                validate_owner(world.as_psid(), trusted).unwrap_err().kind(),
                io::ErrorKind::PermissionDenied
            );
        }

        #[test]
        fn open_path_rejects_relative_and_nul_paths() {
            assert_eq!(
                open_path(Path::new("relative"), READ_CONTROL)
                    .err()
                    .unwrap()
                    .kind(),
                io::ErrorKind::InvalidInput
            );
            let nul_path = std::path::PathBuf::from(OsString::from_wide(&[
                b'C' as u16,
                b':' as u16,
                b'\\' as u16,
                0,
                b'x' as u16,
            ]));
            assert_eq!(
                open_path(&nul_path, READ_CONTROL).err().unwrap().kind(),
                io::ErrorKind::InvalidInput
            );
        }

        #[test]
        fn secure_path_applies_an_exact_protected_file_dacl_idempotently() {
            let (current_user, system, administrators) = trusted_sids();
            let path = temporary_path("file");
            fs::write(&path, "test").unwrap();

            secure_path(&path).unwrap();
            let first = inspect_path(&path).unwrap();
            secure_path(&path).unwrap();
            assert_eq!(
                inspect_path(&path).unwrap(),
                first,
                "file DACL must be idempotent"
            );
            assert!(
                !first.ends_with('\0'),
                "SDDL must not retain the API terminator"
            );
            assert_acl(&path, [&current_user, &system, &administrators], 0, true);

            fs::remove_file(path).unwrap();
        }

        #[test]
        fn secure_path_applies_inheritable_protected_directory_aces() {
            let (current_user, system, administrators) = trusted_sids();
            let directory = temporary_path("directory");
            fs::create_dir(&directory).unwrap();

            secure_path(&directory).unwrap();
            assert_acl(
                &directory,
                [&current_user, &system, &administrators],
                OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
                true,
            );

            let child = directory.join("child.txt");
            fs::write(&child, "test").unwrap();
            assert_inherited_child_acl(&child, [&current_user, &system, &administrators]);

            fs::remove_file(child).unwrap();
            fs::remove_dir(directory).unwrap();
        }
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn non_windows_calls_are_explicitly_unsupported() {
        let path = Path::new("/tmp/acl-prototype");
        assert_eq!(backend(), "unsupported");
        assert_eq!(
            secure_path(path).unwrap_err().kind(),
            std::io::ErrorKind::Unsupported
        );
        assert_eq!(
            inspect_path(path).unwrap_err().kind(),
            std::io::ErrorKind::Unsupported
        );
    }
}
