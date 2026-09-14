use std::{env, path::Path, process::ExitCode};

use serde_json::json;

fn main() -> ExitCode {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.len() == 1 && args[0] == "probe" {
        println!(
            "{}",
            json!({ "version": 1, "backend": acl_prototype_core::backend() })
        );
        return ExitCode::SUCCESS;
    }
    if args.len() != 2 || (args[0] != "secure" && args[0] != "inspect") {
        eprintln!(
            "{}",
            json!({ "version": 1, "error": "usage: acl-prototype-helper probe | secure <path> | inspect <path>" })
        );
        return ExitCode::from(2);
    }
    let path = Path::new(&args[1]);
    let result = if args[0] == "secure" {
        acl_prototype_core::secure_path(path).map(|()| None)
    } else {
        acl_prototype_core::inspect_path(path).map(Some)
    };
    match result {
        Ok(sddl) => {
            println!("{}", json!({ "version": 1, "ok": true, "sddl": sddl }));
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!(
                "{}",
                json!({ "version": 1, "error": error.to_string(), "osCode": error.raw_os_error(), "kind": format!("{:?}", error.kind()) })
            );
            ExitCode::FAILURE
        }
    }
}
