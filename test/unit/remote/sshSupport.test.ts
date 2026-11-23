import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, onTestFinished } from "vitest";

import {
	computeSshProperties,
	resolveSshProperties,
} from "@/remote/sshSupport";

describe.skipIf(spawnSync("ssh", ["-V"]).error)(
	"resolveSshProperties",
	{ timeout: 30_000 },
	() => {
		it("follows Include and Match with ssh on PATH", async () => {
			// Windows OpenSSH reads only ~/ include paths as absolute.
			const dir = await fs.mkdtemp(path.join(os.homedir(), "coder-ssh-g-"));
			onTestFinished(() => fs.rm(dir, { recursive: true, force: true }));
			const config = path.join(dir, "config");
			const included = path.join(dir, "included");
			const includePath = path
				.relative(os.homedir(), included)
				.replaceAll("\\", "/");
			await fs.writeFile(
				config,
				`Host coder-*\n  ProxyCommand coder ssh %h\n  PermitLocalCommand no\nMatch all\n  Include "~/${includePath}"\n`,
			);
			await fs.writeFile(
				included,
				"Host *\n  RemoteCommand tmux attach\n  PermitLocalCommand yes\n",
			);

			const properties = await resolveSshProperties(
				undefined,
				"coder-ws",
				config,
			);
			expect(properties.remotecommand).toBe("tmux attach");
			expect(properties.permitlocalcommand).toBe("no");
		});

		it("rejects a broken config", async () => {
			const missing = path.join(os.tmpdir(), "coder-ssh-g-missing", "config");
			await expect(
				resolveSshProperties(undefined, "coder-ws", missing),
			).rejects.toThrow();
		});

		it("rejects a config without the Coder ProxyCommand", async () => {
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "coder-ssh-g-"));
			onTestFinished(() => fs.rm(dir, { recursive: true, force: true }));
			const config = path.join(dir, "config");
			await fs.writeFile(config, "Host other\n  ProxyCommand coder ssh %h\n");
			await expect(
				resolveSshProperties(undefined, "coder-ws", config),
			).rejects.toThrow("ProxyCommand");
		});
	},
);

it("rejects a Windows batch file without running it", async () => {
	const realPlatform = process.platform;
	Object.defineProperty(process, "platform", { value: "win32" });
	onTestFinished(() => {
		Object.defineProperty(process, "platform", { value: realPlatform });
	});
	await expect(
		resolveSshProperties("C:\\wrappers\\ssh.BAT", "coder-ws", undefined),
	).rejects.toThrow("batch");
});

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

	it.each(["a+b", "a(b", "[a]", "a\\b", "a$b"])(
		"matches Host %s literally",
		(pattern) => {
			const config = `Host ${pattern}\n  User coder`;
			expect(computeSshProperties(pattern, config)).toEqual({ user: "coder" });
			expect(computeSshProperties("ab", config)).toEqual({});
		},
	);

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
