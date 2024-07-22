import * as os from "os"
import url from "url"

export interface AuthorityParts {
  agent: string | undefined
  host: string
  label: string
  username: string
  workspace: string
}

// Prefix is a magic string that is prepended to SSH hosts to indicate that
// they should be handled by this extension.
export const AuthorityPrefix = "coder-vscode"

/**
 * Given an authority, parse into the expected parts.
 *
 * If this is not a Coder host, return null.
 *
 * Throw an error if the host is invalid.
 */
export function parseRemoteAuthority(authority: string): AuthorityParts | null {
  // The authority looks like: vscode://ssh-remote+<ssh host name>
  const authorityParts = authority.split("+")

  // We create SSH host names in one of two formats:
  // coder-vscode--<username>--<workspace>--<agent?> (old style)
  // coder-vscode.<label>--<username>--<workspace>--<agent>
  // The agent can be omitted; the user will be prompted for it instead.
  // Anything else is unrelated to Coder and can be ignored.
  const parts = authorityParts[1].split("--")
  if (parts.length <= 1 || (parts[0] !== AuthorityPrefix && !parts[0].startsWith(`${AuthorityPrefix}.`))) {
    return null
  }

  // It has the proper prefix, so this is probably a Coder host name.
  // Validate the SSH host name.  Including the prefix, we expect at least
  // three parts, or four if including the agent.
  if ((parts.length !== 3 && parts.length !== 4) || parts.some((p) => !p)) {
    throw new Error(`Invalid Coder SSH authority. Must be: <username>--<workspace>--<agent?>`)
  }

  return {
    agent: parts[3] ?? "",
    host: authorityParts[1],
    label: parts[0].replace(/^coder-vscode\.?/, ""),
    username: parts[1],
    workspace: parts[2],
  }
}

/**
 * Given a URL, return the host in a format that is safe to write.
 */
export function toSafeHost(rawUrl: string): string {
  const u = new URL(rawUrl)
  // If the host is invalid, an empty string is returned.  Although, `new URL`
  // should already have thrown in that case.
  return url.domainToASCII(u.hostname) || u.hostname
}

/**
 * Expand a path with ${userHome} in the input string
 * @param input string
 * @returns string
 */
export function expandPath(input: string): string {
  const userHome = os.homedir()
  return input.replace(/\${userHome}/g, userHome)
}
