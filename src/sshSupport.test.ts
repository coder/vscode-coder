import { it, expect } from "vitest"
import { computeSSHProperties, sshSupportsSetEnv, sshVersionSupportsSetEnv } from "./sshSupport"

const supports = {
  "OpenSSH_8.9p1 Ubuntu-3ubuntu0.1, OpenSSL 3.0.2 15 Mar 2022": true,
  "OpenSSH_for_Windows_8.1p1, LibreSSL 3.0.2": true,
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
  ProxyCommand=/tmp/coder --header="X-FOO=bar" coder.dev
# --- END CODER VSCODE ---
`,
  )

  expect(properties).toEqual({
    Another: "true",
    StrictHostKeyChecking: "yes",
    ProxyCommand: '/tmp/coder --header="X-FOO=bar" coder.dev',
  })
})

it("handles ? wildcards", () => {
  const properties = computeSSHProperties(
    "coder-vscode--testing",
    `Host *
  StrictHostKeyChecking yes

Host i-???????? i-?????????????????
  User test

# --- START CODER VSCODE ---
Host coder-v?ode--*
  StrictHostKeyChecking yes
  Another=false
Host coder-v?code--*
  StrictHostKeyChecking no
  Another=true
  ProxyCommand=/tmp/coder --header="X-BAR=foo" coder.dev
# --- END CODER VSCODE ---
`,
  )

  expect(properties).toEqual({
    Another: "true",
    StrictHostKeyChecking: "yes",
    ProxyCommand: '/tmp/coder --header="X-BAR=foo" coder.dev',
  })
})

it("properly escapes meaningful regex characters", () => {
  const properties = computeSSHProperties(
    "coder-vscode.dev.coder.com--matalfi--dogfood",
    `Host *
  StrictHostKeyChecking yes

# ------------START-CODER-----------
# This section is managed by coder. DO NOT EDIT.
#
# You should not hand-edit this section unless you are removing it, all
# changes will be lost when running "coder config-ssh".
#
Host coder.*
        StrictHostKeyChecking=no
        UserKnownHostsFile=/dev/null
        ProxyCommand /usr/local/bin/coder --global-config "/Users/matifali/Library/Application Support/coderv2" ssh --stdio --ssh-host-prefix coder. %h
# ------------END-CODER------------

# --- START CODER VSCODE dev.coder.com ---
Host coder-vscode.dev.coder.com--*
  StrictHostKeyChecking no
  UserKnownHostsFile=/dev/null
  ProxyCommand "/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/dev.coder.com/bin/coder-darwin-arm64" vscodessh --network-info-dir "/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/net" --session-token-file "/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/dev.coder.com/session" --url-file "/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/dev.coder.com/url" %h
# --- END CODER VSCODE dev.coder.com ---%

`,
  )

  expect(properties).toEqual({
    StrictHostKeyChecking: "yes",
    ProxyCommand:
      '"/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/dev.coder.com/bin/coder-darwin-arm64" vscodessh --network-info-dir "/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/net" --session-token-file "/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/dev.coder.com/session" --url-file "/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/dev.coder.com/url" %h',
    UserKnownHostsFile: "/dev/null",
  })
})
