import { describe, it, expect } from "vitest";

import {
	computeSshProperties,
	sshSupportsSetEnv,
	sshVersionSupportsSetEnv,
} from "@/remote/sshSupport";

const supports = {
	"OpenSSH_8.9p1 Ubuntu-3ubuntu0.1, OpenSSL 3.0.2 15 Mar 2022": true,
	"OpenSSH_for_Windows_8.1p1, LibreSSL 3.0.2": true,
	"OpenSSH_9.0p1, LibreSSL 3.3.6": true,
	// Version extracted from OpenSSH, not from LibreSSL after the comma
	"OpenSSH_7.4p1, LibreSSL_8.1.0": false,
	"OpenSSH_7.6p1 Ubuntu-4ubuntu0.7, OpenSSL 1.0.2n 7 Dec 2017": false,
	"OpenSSH_7.4p1, OpenSSL 1.0.2k-fips  26 Jan 2017": false,
};

Object.entries(supports).forEach(([version, expected]) => {
	it(version, () => {
		expect(sshVersionSupportsSetEnv(version)).toBe(expected);
	});
});

/**
 * Spawning real `ssh` is slow on Windows CI runners, so allow a larger budget there.
 */
it(
	"current shell supports ssh",
	{ timeout: process.platform === "win32" ? 30_000 : undefined },
	() => {
		expect(sshSupportsSetEnv()).toBeTruthy();
	},
);

describe("computeSshProperties", () => {
	it("computes the config for a host", () => {
		const properties = computeSshProperties(
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
		);

		expect(properties).toEqual({
			another: "true",
			stricthostkeychecking: "yes",
			proxycommand: '/tmp/coder --header="X-FOO=bar" coder.dev',
		});
	});

	it("handles ? wildcards", () => {
		const properties = computeSshProperties(
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
		);

		expect(properties).toEqual({
			another: "true",
			stricthostkeychecking: "yes",
			proxycommand: '/tmp/coder --header="X-BAR=foo" coder.dev',
		});
	});

	it("resolves directives case-insensitively, first obtained value wins", () => {
		const properties = computeSshProperties(
			"coder-vscode.example.com--user--ws",
			`host coder-vscode.example.com--*
  proxycommand /path/to/coder ssh --stdio %h
  RemoteCommand exec /bin/first
  remotecommand exec /bin/second

Host *
  REMOTECOMMAND exec /bin/fallback
  ForwardAgent yes
`,
		);

		expect(properties).toEqual({
			proxycommand: "/path/to/coder ssh --stdio %h",
			remotecommand: "exec /bin/first",
			forwardagent: "yes",
		});
	});

	it("picks up RemoteCommand from a user Host block alongside a Coder block", () => {
		const props = computeSshProperties(
			"coder-vscode.example.com--user--ws",
			`# --- START CODER VSCODE example.com ---
Host coder-vscode.example.com--*
  ProxyCommand /path/to/coder ssh --stdio %h
  StrictHostKeyChecking no
# --- END CODER VSCODE example.com ---

Host coder-vscode.example.com--*
  RequestTTY yes
  RemoteCommand exec /bin/bash -l
`,
		);
		expect(props.remotecommand).toBe("exec /bin/bash -l");
		expect(props.proxycommand).toBe("/path/to/coder ssh --stdio %h");
	});

	it("returns RemoteCommand none literally", () => {
		const props = computeSshProperties(
			"coder-vscode.example.com--user--ws",
			`Host coder-vscode.example.com--*
  RemoteCommand none
`,
		);
		expect(props.remotecommand).toBe("none");
	});

	it("inherits RemoteCommand from a Host * block", () => {
		const props = computeSshProperties(
			"coder-vscode.example.com--user--ws",
			`Host *
  RemoteCommand exec /bin/zsh -l

Host coder-vscode.example.com--*
  ProxyCommand /path/to/coder ssh --stdio %h
`,
		);
		expect(props.remotecommand).toBe("exec /bin/zsh -l");
	});

	it("handles RemoteCommand with = delimiter", () => {
		const props = computeSshProperties(
			"coder-vscode.example.com--user--ws",
			`Host coder-vscode.example.com--*
  RemoteCommand=exec /bin/bash -l
`,
		);
		expect(props.remotecommand).toBe("exec /bin/bash -l");
	});

	it("properly escapes meaningful regex characters", () => {
		const properties = computeSshProperties(
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
		);

		expect(properties).toEqual({
			stricthostkeychecking: "yes",
			proxycommand:
				'"/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/dev.coder.com/bin/coder-darwin-arm64" vscodessh --network-info-dir "/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/net" --session-token-file "/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/dev.coder.com/session" --url-file "/Users/matifali/Library/Application Support/Code/User/globalStorage/coder.coder-remote/dev.coder.com/url" %h',
			userknownhostsfile: "/dev/null",
		});
	});
});
