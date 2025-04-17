import { lookup } from "dns"
import ipRangeCheck from "ip-range-check"
import * as os from "os"
import url from "url"
import { promisify } from "util"

export interface AuthorityParts {
  containerNameHex: string | undefined
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
  // The Dev Container authority looks like: vscode://attached-container+containerNameHex@ssh-remote+<ssh host name>
  // The SSH authority looks like: vscode://ssh-remote+<ssh host name>
  const authorityParts = authority.split("@")
  let containerNameHex = undefined
  let sshAuthority
  if (authorityParts.length === 1) {
    sshAuthority = authorityParts[0]
  } else if (authorityParts.length === 2 && authorityParts[0].includes("attached-container+")) {
    sshAuthority = authorityParts[1]
    containerNameHex = authorityParts[0].split("+")[1]
  } else {
    return null
  }
  const sshAuthorityParts = sshAuthority.split("+")

  // We create SSH host names in a format matching:
  // coder-vscode(--|.)<username>--<workspace>(--|.)<agent?>
  // The agent can be omitted; the user will be prompted for it instead.
  // Anything else is unrelated to Coder and can be ignored.
  const parts = sshAuthorityParts[1].split("--")
  if (parts.length <= 1 || (parts[0] !== AuthorityPrefix && !parts[0].startsWith(`${AuthorityPrefix}.`))) {
    return null
  }

  // It has the proper prefix, so this is probably a Coder host name.
  // Validate the SSH host name.  Including the prefix, we expect at least
  // three parts, or four if including the agent.
  if ((parts.length !== 3 && parts.length !== 4) || parts.some((p) => !p)) {
    throw new Error(`Invalid Coder SSH authority. Must be: <username>--<workspace>(--|.)<agent?>`)
  }

  let workspace = parts[2]
  let agent = ""
  if (parts.length === 4) {
    agent = parts[3]
  } else if (parts.length === 3) {
    const workspaceParts = parts[2].split(".")
    if (workspaceParts.length === 2) {
      workspace = workspaceParts[0]
      agent = workspaceParts[1]
    }
  }

  return {
    containerNameHex: containerNameHex,
    agent: agent,
    host: sshAuthorityParts[1],
    label: parts[0].replace(/^coder-vscode\.?/, ""),
    username: parts[1],
    workspace: workspace,
  }
}

export async function maybeCoderConnectAddr(
  agent: string,
  workspace: string,
  owner: string,
  hostnameSuffix: string,
): Promise<string | undefined> {
  const coderConnectHostname = `${agent}.${workspace}.${owner}.${hostnameSuffix}`
  try {
    const res = await promisify(lookup)(coderConnectHostname)
    // Captive DNS portals may return an unrelated address, so we check it's
    // within the Coder Service Prefix.
    return res.family === 6 && ipRangeCheck(res.address, "fd60:627a:a42b::/48") ? coderConnectHostname : undefined
  } catch {
    return undefined
  }
}

export function toRemoteAuthority(
  baseUrl: string,
  workspaceOwner: string,
  workspaceName: string,
  workspaceAgent: string | undefined,
): string {
  let remoteAuthority = `ssh-remote+${AuthorityPrefix}.${toSafeHost(baseUrl)}--${workspaceOwner}--${workspaceName}`
  if (workspaceAgent) {
    remoteAuthority += `.${workspaceAgent}`
  }
  return remoteAuthority
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
