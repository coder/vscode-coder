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
	interface SectionCase {
		id: string;
		key: string;
	}

	it.each<SectionCase>([
		{ id: "ms-vscode-remote.remote-ssh", key: "remote.SSH.configFile" },
		{ id: "anysphere.remote-ssh", key: "remote.SSH.configFile" },
		{ id: "jeanp413.open-remote-ssh", key: "remote.SSH.configFile" },
		{
			id: "google.antigravity-remote-openssh",
			key: "remote.antigravitySSH.configFile",
		},
		{
			id: "codeium.windsurf-remote-openssh",
			key: "remote.devinSSH.configFile",
		},
	])("reads the section $id uses", ({ id, key }) => {
		setup(id, { [key]: "/custom/config" });

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
