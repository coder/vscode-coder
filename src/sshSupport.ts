import * as childProcess from "child_process"

export function sshSupportsSetEnv(): boolean {
  try {
    // Run `ssh -V` to get the version string.
    const spawned = childProcess.spawnSync("ssh", ["-V"])
    // The version string outputs to stderr.
    return sshVersionSupportsSetEnv(spawned.stderr.toString().trim())
  } catch (error) {
    return false
  }
}

// sshVersionSupportsSetEnv ensures that the version string from the SSH
// command line supports the `SetEnv` directive.
//
// It was introduced in SSH 7.8 and not all versions support it.
export function sshVersionSupportsSetEnv(sshVersionString: string): boolean {
  const match = sshVersionString.match(/OpenSSH_([\d.]+)[^,]*/)
  if (match && match[1]) {
    const installedVersion = match[1]
    const parts = installedVersion.split(".")
    if (parts.length < 2) {
      return false
    }
    // 7.8 is the first version that supports SetEnv
    if (Number.parseInt(parts[0], 10) < 7) {
      return false
    }
    if (Number.parseInt(parts[1], 10) < 8) {
      return false
    }
    return true
  }
  return false
}
