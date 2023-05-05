import { it, expect } from "vitest"
import { computeSSHProperties, sshSupportsSetEnv, sshVersionSupportsSetEnv } from "./sshSupport"

const supports = {
  "OpenSSH_8.9p1 Ubuntu-3ubuntu0.1, OpenSSL 3.0.2 15 Mar 2022": true,
  "OpenSSH_9.0p1, LibreSSL 3.3.6": true,
  "OpenSSH_7.6p1 Ubuntu-4ubuntu0.7, OpenSSL 1.0.2n 7 Dec 2017": false,
  "OpenSSH_7.4p1, OpenSSL 1.0.2k-fips  26 Jan 2017": false,
}

Object.entries(supports).forEach(([version, expected]) => {
  it(version, () => {
    expect(sshVersionSupportsSetEnv(version)).toBe(expected)
  })
})

it("current shell supports ssh", () => {
  expect(sshSupportsSetEnv()).toBeTruthy()
})

it("computes the config for a host", () => {
  const properties = computeSSHProperties(
    "coder-vscode--testing",
    `Host *
  StrictHostKeyChecking yes

# --- START CODER VSCODE ---
Host coder-vscode--*
  StrictHostKeyChecking no
  Another=true
# --- END CODER VSCODE ---
`,
  )

  expect(properties).toEqual({
    Another: "true",
    StrictHostKeyChecking: "yes",
  })
})
