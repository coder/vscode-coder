import { SemVer } from "semver"

// CLI versions before 2.3.3 don't support the --log-dir flag!
// If this check didn't exist, VS Code connections would fail on
// older versions because of an unknown CLI argument.
export const supportsCoderAgentLogDirFlag = (ver: SemVer | null): boolean => {
  return (ver?.compare("2.3.3") || 0) > 0 || ver?.prerelease[0] === "devel"
}
