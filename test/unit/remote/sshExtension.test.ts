import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { getRemoteSshConfigFile } from "@/remote/sshExtension";

import { config, type Settings } from "../../mocks/testHelpers";

/** Activate `extensionId`, or no Remote-SSH extension when empty. */
function setup(extensionId: string, settings: Settings = {}): void {
	config(settings);
	vi.mocked(vscode.extensions.getExtension).mockImplementation((id) =>
		id === extensionId ? ({ id } as vscode.Extension<unknown>) : undefined,
	);
}

describe("getRemoteSshConfigFile", () => {
	it.each([
		"ms-vscode-remote.remote-ssh",
		"anysphere.remote-ssh",
		"jeanp413.open-remote-ssh",
	])("reads the configured file for %s", (extensionId) => {
		setup(extensionId, { "remote.SSH.configFile": "/custom/config" });

		expect(getRemoteSshConfigFile()).toBe("/custom/config");
	});

	it.each([
		["google.antigravity-remote-openssh", "remote.antigravitySSH.configFile"],
		["codeium.windsurf-remote-openssh", "remote.devinSSH.configFile"],
	])(
		"ignores the file %s never connects through",
		(extensionId, settingKey) => {
			setup(extensionId, {
				[settingKey]: "/custom/config",
				"remote.SSH.configFile": "/stale/config",
			});

			expect(getRemoteSshConfigFile()).toBeUndefined();
		},
	);

	it("reads remote.SSH when no extension is installed", () => {
		setup("", { "remote.SSH.configFile": "/custom/config" });

		expect(getRemoteSshConfigFile()).toBe("/custom/config");
	});

	it("returns undefined when nothing is configured", () => {
		setup("ms-vscode-remote.remote-ssh");

		expect(getRemoteSshConfigFile()).toBeUndefined();
	});
});
