import { vol } from "memfs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	getRemoteSshConfigFile,
	getRemoteSshPath,
} from "@/remote/sshExtension";

import { config, type Settings } from "../../mocks/testHelpers";

vi.mock("node:fs", async () => (await import("memfs")).fs);

const ANTIGRAVITY = "google.antigravity-remote-openssh";
const DEVIN = "codeium.windsurf-remote-openssh";
const OPEN_REMOTE_SSH = "jeanp413.open-remote-ssh";

/** Activate `id` (none when empty), inside a Devin build when versioned. */
function setup(id: string, settings: Settings, windsurfVersion?: string) {
	config(settings);
	vol.reset();
	if (windsurfVersion) {
		const product = path.join(vscode.env.appRoot, "product.json");
		vol.fromJSON({ [product]: JSON.stringify({ windsurfVersion }) });
	}
	vi.mocked(vscode.extensions.getExtension).mockImplementation((extId) =>
		extId === id ? ({ id } as vscode.Extension<unknown>) : undefined,
	);
}

it.each(["ms-vscode-remote.remote-ssh", "anysphere.remote-ssh", ""])(
	"reads and expands remote.SSH settings for '%s'",
	(id) => {
		setup(id, {
			"remote.SSH.configFile": "~/cfg",
			"remote.SSH.path": "/ssh",
		});

		expect(getRemoteSshConfigFile()).toBe(`${os.homedir()}/cfg`);
		expect(getRemoteSshPath()).toBe("/ssh");
	},
);

it.each<[string, string, Settings, string | undefined, string?]>([
	[
		"open-remote-ssh",
		OPEN_REMOTE_SSH,
		{ "remote.SSH.configFile": "/cfg" },
		"/cfg",
	],
	[
		"Antigravity",
		ANTIGRAVITY,
		{ "remote.antigravitySSH.configFile": "/cfg" },
		undefined,
	],
	[
		"Devin before 3.12.32",
		DEVIN,
		{ "remote.devinSSH.configFile": "/cfg" },
		undefined,
		"3.11.238",
	],
	[
		"Devin of unknown version",
		DEVIN,
		{ "remote.devinSSH.configFile": "/cfg" },
		undefined,
	],
	[
		"Devin from 3.12.32",
		DEVIN,
		{ "remote.devinSSH.configFile": "/cfg" },
		"/cfg",
		"3.12.32",
	],
])("config file for %s", (_name, id, settings, expected, windsurfVersion) => {
	setup(
		id,
		{ "remote.SSH.configFile": "/stale", ...settings },
		windsurfVersion,
	);
	expect(getRemoteSshConfigFile()).toBe(expected);
});

it.each<[string, string, Settings, string | undefined]>([
	[
		"Antigravity",
		ANTIGRAVITY,
		{ "remote.antigravitySSH.path": "/ssh" },
		"/ssh",
	],
	["Devin", DEVIN, { "remote.devinSSH.path": "/ssh" }, "/ssh"],
	["open-remote-ssh's ssh2 backend", OPEN_REMOTE_SSH, {}, undefined],
	[
		"open-remote-ssh's native backend",
		OPEN_REMOTE_SSH,
		{ "remote.SSH.path": "/ssh", "remote.SSH.connectionBackend": "native" },
		"/ssh",
	],
])("ssh path for %s", (_name, id, settings, expected) => {
	setup(id, { "remote.SSH.path": "/stale", ...settings });
	expect(getRemoteSshPath()).toBe(expected);
});
