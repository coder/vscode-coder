import * as jsonc from "jsonc-parser";
import * as fs from "node:fs/promises";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";

export interface SettingOverride {
	key: string;
	value: unknown;
}

interface RecommendedSetting {
	readonly value: number | null;
	readonly label: string;
}

export const RECOMMENDED_SSH_SETTINGS = {
	"remote.SSH.connectTimeout": {
		value: 1800,
		label: "Connect Timeout: 1800s (30 min)",
	},
	"remote.SSH.reconnectionGraceTime": {
		value: 28800,
		label: "Reconnection Grace Time: 28800s (8 hours)",
	},
	"remote.SSH.serverShutdownTimeout": {
		value: 28800,
		label: "Server Shutdown Timeout: 28800s (8 hours)",
	},
	"remote.SSH.maxReconnectionAttempts": {
		value: null,
		label: "Max Reconnection Attempts: max allowed",
	},
} as const satisfies Record<string, RecommendedSetting>;

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

	// Set the remote platform for this host to bypass the platform prompt.
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

	// Default 15s is too short for startup scripts; enforce a minimum.
	const minConnTimeout =
		RECOMMENDED_SSH_SETTINGS["remote.SSH.connectTimeout"].value;
	const connTimeout = config.get<number>("remote.SSH.connectTimeout");
	if (!connTimeout || connTimeout < minConnTimeout) {
		overrides.push({
			key: "remote.SSH.connectTimeout",
			value: minConnTimeout,
		});
	}

	// Set recommended defaults for settings the user hasn't configured.
	const setIfUndefined = [
		"remote.SSH.reconnectionGraceTime",
		"remote.SSH.serverShutdownTimeout",
		"remote.SSH.maxReconnectionAttempts",
	] as const;
	for (const key of setIfUndefined) {
		if (config.get(key) === undefined) {
			overrides.push({ key, value: RECOMMENDED_SSH_SETTINGS[key].value });
		}
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
