import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { getRemoteSshSetting } from "@/remote/sshExtension";

import { config, type Settings } from "../../mocks/testHelpers";

/** Activate `extensionId`, or no Remote-SSH extension when empty. */
function setup(extensionId: string, settings: Settings = {}): void {
	config(settings);
	vi.mocked(vscode.extensions.getExtension).mockImplementation((id) =>
		id === extensionId ? ({ id } as vscode.Extension<unknown>) : undefined,
	);
}

describe("getRemoteSshSetting", () => {
	it.each([
		["ms-vscode-remote.remote-ssh", "remote.SSH.configFile"],
		["anysphere.remote-ssh", "remote.SSH.configFile"],
		["jeanp413.open-remote-ssh", "remote.SSH.configFile"],
		["google.antigravity-remote-openssh", "remote.antigravitySSH.configFile"],
		["codeium.windsurf-remote-openssh", "remote.devinSSH.configFile"],
	])("reads the section %s uses", (extensionId, settingKey) => {
		setup(extensionId, { [settingKey]: "/custom/config" });

		expect(getRemoteSshSetting("configFile")).toBe("/custom/config");
	});

	it("falls back to the legacy Windsurf section", () => {
		setup("codeium.windsurf-remote-openssh", {
			"remote.windsurfSSH.configFile": "/legacy/config",
		});

		expect(getRemoteSshSetting("configFile")).toBe("/legacy/config");
	});

	it("prefers the Devin section over the legacy Windsurf one", () => {
		setup("codeium.windsurf-remote-openssh", {
			"remote.devinSSH.configFile": "/devin/config",
			"remote.windsurfSSH.configFile": "/legacy/config",
		});

		expect(getRemoteSshSetting("configFile")).toBe("/devin/config");
	});

	it("ignores another extension's section", () => {
		setup("google.antigravity-remote-openssh", {
			"remote.SSH.configFile": "/custom/config",
		});

		expect(getRemoteSshSetting("configFile")).toBeUndefined();
	});

	it("defaults to remote.SSH when no extension is installed", () => {
		setup("", { "remote.SSH.configFile": "/custom/config" });

		expect(getRemoteSshSetting("configFile")).toBe("/custom/config");
	});
});
