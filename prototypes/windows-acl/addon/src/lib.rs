use std::path::PathBuf;

use napi::{bindgen_prelude::AsyncTask, Env, Error, Result, Task};
use napi_derive::napi;

#[napi]
pub fn probe() -> String {
    acl_prototype_core::backend().to_owned()
}

pub struct SecureTask {
    path: PathBuf,
}

impl Task for SecureTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<()> {
        acl_prototype_core::secure_path(&self.path).map_err(|error| {
            Error::from_reason(format!("{} (osCode={:?})", error, error.raw_os_error()))
        })
    }

    fn resolve(&mut self, _env: Env, _output: ()) -> Result<()> {
        Ok(())
    }
}

#[napi]
pub fn secure(path: String) -> AsyncTask<SecureTask> {
    AsyncTask::new(SecureTask {
        path: PathBuf::from(path),
    })
}

pub struct InspectTask {
    path: PathBuf,
}

impl Task for InspectTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<String> {
        acl_prototype_core::inspect_path(&self.path).map_err(|error| {
            Error::from_reason(format!("{} (osCode={:?})", error, error.raw_os_error()))
        })
    }

    fn resolve(&mut self, _env: Env, output: String) -> Result<String> {
        Ok(output)
    }
}

#[napi]
pub fn inspect(path: String) -> AsyncTask<InspectTask> {
    AsyncTask::new(InspectTask {
        path: PathBuf::from(path),
    })
}
