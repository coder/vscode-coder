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
    use std::io;
    use std::mem::size_of;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, LocalFree};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSecurityDescriptorToStringSecurityDescriptorW, GetSecurityInfo, SE_FILE_OBJECT,
        SetSecurityInfo,
    };
    use windows_sys::Win32::Security::{
        ACL, ACL_REVISION, AddAccessAllowedAceEx, CopySid, CreateWellKnownSid,
        DACL_SECURITY_INFORMATION, EqualSid, GROUP_SECURITY_INFORMATION, GetLengthSid,
        GetSecurityDescriptorOwner, GetTokenInformation, InitializeAcl, IsValidSid,
        OBJECT_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
        TOKEN_QUERY, TOKEN_USER, TokenUser, WinBuiltinAdministratorsSid, WinLocalSystemSid,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, CreateFileW, FILE_ALL_ACCESS, FILE_ATTRIBUTE_DIRECTORY,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileInformationByHandle,
        OPEN_EXISTING, READ_CONTROL, WRITE_DAC,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    const PROTECTED_DACL_SECURITY_INFORMATION: u32 = 0x8000_0000;
    const PROTECTED_FILE_ACCESS: u32 = FILE_ALL_ACCESS;
    const CONTAINER_INHERIT_ACE: u8 = 0x02;
    const OBJECT_INHERIT_ACE: u8 = 0x01;
    const SDDL_REVISION_1: u32 = 1;

    pub fn secure_path(path: &Path) -> io::Result<()> {
        let path = WidePath::new(path)?;
        let handle = FileHandle::open_for_write(&path)?;
        let attributes = handle.attributes()?;
        if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(invalid_input(
                "final path component must not be a reparse point",
            ));
        }

        let current_user = SidBuffer::current_user()?;
        let descriptor = SecurityDescriptor::get(handle.0)?;
        validate_owner(descriptor.owner()?, &current_user)?;

        let inheritance = if attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
            CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE
        } else {
            0
        };
        let system = SidBuffer::well_known(WinLocalSystemSid)?;
        let administrators = SidBuffer::well_known(WinBuiltinAdministratorsSid)?;
        let acl = ProtectedAcl::new([&current_user, &system, &administrators], inheritance)?;
        unsafe {
            check(SetSecurityInfo(
                handle.0,
                SE_FILE_OBJECT,
                (DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION)
                    as OBJECT_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                acl.as_ptr(),
                null(),
            ))?;
        }
        Ok(())
    }

    pub fn inspect_path(path: &Path) -> io::Result<String> {
        let path = WidePath::new(path)?;
        let handle = FileHandle::open_for_read(&path)?;
        SecurityDescriptor::get(handle.0)?.to_sddl()
    }

    struct WidePath(Vec<u16>);

    impl WidePath {
        fn new(path: &Path) -> io::Result<Self> {
            if !path.is_absolute() {
                return Err(invalid_input("path must be absolute"));
            }
            let units: Vec<u16> = path.as_os_str().encode_wide().collect();
            if units.contains(&0) {
                return Err(invalid_input("path contains a NUL character"));
            }
            Ok(Self(units.into_iter().chain(Some(0)).collect()))
        }
    }

    struct FileHandle(HANDLE);

    impl FileHandle {
        fn open_for_read(path: &WidePath) -> io::Result<Self> {
            Self::open(path, READ_CONTROL)
        }

        fn open_for_write(path: &WidePath) -> io::Result<Self> {
            Self::open(path, READ_CONTROL | WRITE_DAC)
        }

        fn open(path: &WidePath, desired_access: u32) -> io::Result<Self> {
            let handle = unsafe {
                CreateFileW(
                    path.0.as_ptr(),
                    desired_access,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    null(),
                    OPEN_EXISTING,
                    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                    null_mut(),
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(handle))
        }

        fn attributes(&self) -> io::Result<u32> {
            let mut information = BY_HANDLE_FILE_INFORMATION::default();
            unsafe { check_bool(GetFileInformationByHandle(self.0, &mut information))? };
            Ok(information.dwFileAttributes)
        }
    }

    impl Drop for FileHandle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    struct TokenHandle(HANDLE);

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
            Ok(Self(token))
        }
    }

    impl Drop for TokenHandle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Stores SID bytes in usize elements so the buffer remains properly aligned.
    struct SidBuffer {
        storage: Vec<usize>,
    }

    impl SidBuffer {
        fn current_user() -> io::Result<Self> {
            let token = TokenHandle::current_process()?;
            let mut length = 0;
            unsafe { GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut length) };
            if length == 0 {
                return Err(io::Error::last_os_error());
            }

            let mut token_user = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
            unsafe {
                check_bool(GetTokenInformation(
                    token.0,
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
                check_bool(CopySid(
                    (sid.storage.len() * size_of::<usize>()) as u32,
                    sid.as_psid(),
                    source_sid,
                ))?;
                Ok(sid)
            }
        }

        fn well_known(kind: i32) -> io::Result<Self> {
            let mut length = 0;
            unsafe { CreateWellKnownSid(kind, null_mut(), null_mut(), &mut length) };
            if length == 0 {
                return Err(io::Error::last_os_error());
            }

            let mut sid = Self::with_byte_capacity(length as usize);
            unsafe {
                check_bool(CreateWellKnownSid(
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
        fn get(handle: HANDLE) -> io::Result<Self> {
            let mut descriptor = null_mut();
            unsafe {
                check(GetSecurityInfo(
                    handle,
                    SE_FILE_OBJECT,
                    (OWNER_SECURITY_INFORMATION
                        | GROUP_SECURITY_INFORMATION
                        | DACL_SECURITY_INFORMATION)
                        as OBJECT_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    &mut descriptor,
                ))?;
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
            if owner.is_null() {
                return Err(invalid_input("path security descriptor has no owner"));
            }
            Ok(owner)
        }

        fn to_sddl(&self) -> io::Result<String> {
            let mut value = null_mut();
            let mut length = 0;
            unsafe {
                check_bool(ConvertSecurityDescriptorToStringSecurityDescriptorW(
                    self.0,
                    SDDL_REVISION_1,
                    DACL_SECURITY_INFORMATION as OBJECT_SECURITY_INFORMATION,
                    &mut value,
                    &mut length,
                ))?;
                let mut units = std::slice::from_raw_parts(value, length as usize).to_vec();
                while units.last() == Some(&0) {
                    units.pop();
                }
                let sddl = OsString::from_wide(&units).to_string_lossy().into_owned();
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

    fn validate_owner(owner: PSID, current_user: &SidBuffer) -> io::Result<()> {
        let system = SidBuffer::well_known(WinLocalSystemSid)?;
        let administrators = SidBuffer::well_known(WinBuiltinAdministratorsSid)?;
        let trusted = unsafe {
            EqualSid(owner, current_user.as_psid()) != 0
                || EqualSid(owner, system.as_psid()) != 0
                || EqualSid(owner, administrators.as_psid()) != 0
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

    struct ProtectedAcl {
        // usize elements keep the ACL allocation aligned for all Win32 structures.
        storage: Vec<usize>,
    }

    impl ProtectedAcl {
        fn new(sids: [&SidBuffer; 3], inheritance: u8) -> io::Result<Self> {
            let bytes = size_of::<ACL>()
                + sids
                    .iter()
                    .map(|sid| {
                        // ACE_HEADER + ACCESS_MASK, followed by the SID.
                        8 + unsafe { GetLengthSid(sid.as_psid()) as usize }
                    })
                    .sum::<usize>();
            let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
            let acl = storage.as_mut_ptr().cast::<ACL>();
            unsafe {
                check_bool(InitializeAcl(acl, bytes as u32, ACL_REVISION))?;
                for sid in sids {
                    check_bool(AddAccessAllowedAceEx(
                        acl,
                        ACL_REVISION,
                        inheritance as u32,
                        PROTECTED_FILE_ACCESS,
                        sid.as_psid(),
                    ))?;
                }
            }
            Ok(Self { storage })
        }

        fn as_ptr(&self) -> *const ACL {
            self.storage.as_ptr().cast()
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

        const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

        fn assert_protected_file_acl(path: &Path, expected_sids: [&SidBuffer; 3]) {
            let path = WidePath::new(path).unwrap();
            let handle = FileHandle::open_for_read(&path).unwrap();
            let descriptor = SecurityDescriptor::get(handle.0).unwrap();
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
            assert_ne!(control & SE_DACL_PROTECTED, 0, "DACL must be protected");

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
                        0,
                        "file ACE {index} must not inherit",
                    );
                    assert_eq!(
                        (*ace).Mask,
                        PROTECTED_FILE_ACCESS,
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

        #[test]
        fn secure_path_protects_a_real_file_with_the_current_user_ace() {
            let current_user = SidBuffer::current_user().unwrap();
            let system = SidBuffer::well_known(WinLocalSystemSid).unwrap();
            let administrators = SidBuffer::well_known(WinBuiltinAdministratorsSid).unwrap();
            let path = std::env::temp_dir().join(format!(
                "acl-prototype-{}-{}.txt",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::write(&path, "test").unwrap();

            secure_path(&path).unwrap();
            secure_path(&path).unwrap();
            let sddl = inspect_path(&path).unwrap();

            assert!(
                !sddl.ends_with('\0'),
                "SDDL must not retain the API terminator"
            );
            assert_protected_file_acl(&path, [&current_user, &system, &administrators]);

            fs::remove_file(path).unwrap();
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
