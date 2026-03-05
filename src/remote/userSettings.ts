import * as jsonc from "jsonc-parser";
import * as fs from "node:fs/promises";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";

export interface SettingOverride {
	key: string;
	value: unknown;
}

/**
 * Build the list of VS Code setting overrides needed for a remote SSH
 * connection to a Coder workspace.
 */
export function buildSshOverrides(
	config: Pick<WorkspaceConfiguration, "get">,
	sshHost: string,
	agentOS: string,
): SettingOverride[] {
	const overrides: SettingOverride[] = [];

	// Bypass the platform prompt by setting the remote platform for this host.
	const remotePlatforms = config.get<Record<string, string>>(
		"remote.SSH.remotePlatform",
		{},
	);
	if (remotePlatforms[sshHost] !== agentOS) {
		overrides.push({
			key: "remote.SSH.remotePlatform",
			value: { ...remotePlatforms, [sshHost]: agentOS },
		});
	}

	// VS Code's default connect timeout of 15s is too short when waiting for
	// startup scripts. Enforce a minimum.
	const minConnTimeout = 1800;
	const connTimeout = config.get<number>("remote.SSH.connectTimeout");
	if (!connTimeout || connTimeout < minConnTimeout) {
		overrides.push({
			key: "remote.SSH.connectTimeout",
			value: minConnTimeout,
		});
	}

	// VS Code's default reconnection grace time (ProtocolConstants.ReconnectionGraceTime)
	// is 3 hours (10800s). Coder workspaces commonly go offline overnight, so we
	// bump to 8 hours. See https://github.com/microsoft/vscode/blob/main/src/vs/base/parts/ipc/common/ipc.net.ts
	if (config.get<number>("remote.SSH.reconnectionGraceTime") === undefined) {
		overrides.push({
			key: "remote.SSH.reconnectionGraceTime",
			value: 28800, // 8 hours in seconds
		});
	}

	return overrides;
}

/**
 * Apply setting overrides to the user's settings.json file.
 *
 * We munge the file directly with jsonc instead of using the VS Code API
 * because the API hangs indefinitely during remote connection setup (likely
 * a deadlock from trying to update config on the not-yet-connected remote).
 */
export async function applySettingOverrides(
	settingsFilePath: string,
	overrides: SettingOverride[],
	logger: Logger,
): Promise<boolean> {
	if (overrides.length === 0) {
		return false;
	}

	let settingsContent = "{}";
	try {
		settingsContent = await fs.readFile(settingsFilePath, "utf8");
	} catch {
		// File probably doesn't exist yet.
	}

	for (const { key, value } of overrides) {
		settingsContent = jsonc.applyEdits(
			settingsContent,
			jsonc.modify(settingsContent, [key], value, {}),
		);
	}

	try {
		await fs.writeFile(settingsFilePath, settingsContent);
		return true;
	} catch (ex) {
		// Could be read-only (e.g. home-manager on NixOS). Not catastrophic.
		logger.warn("Failed to configure settings", ex);
		return false;
	}
}
