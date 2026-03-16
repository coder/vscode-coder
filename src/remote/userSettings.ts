import { formatDuration, intervalToDuration } from "date-fns";
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

function recommended(
	shortName: string,
	value: number | null,
): RecommendedSetting {
	if (value === null) {
		return { value, label: `${shortName}: max allowed` };
	}
	const humanized = formatDuration(
		intervalToDuration({ start: 0, end: value * 1000 }),
	);
	return { value, label: `${shortName}: ${humanized}` };
}

/** Applied by the "Apply Recommended SSH Settings" command. */
export const RECOMMENDED_SSH_SETTINGS = {
	"remote.SSH.connectTimeout": recommended("Connect Timeout", 1800),
	"remote.SSH.reconnectionGraceTime": recommended(
		"Reconnection Grace Time",
		86400,
	),
	"remote.SSH.serverShutdownTimeout": recommended(
		"Server Shutdown Timeout",
		86400,
	),
	"remote.SSH.maxReconnectionAttempts": recommended(
		"Max Reconnection Attempts",
		null,
	),
} as const satisfies Record<string, RecommendedSetting>;

type SshSettingKey = keyof typeof RECOMMENDED_SSH_SETTINGS;

/** Defaults set during connection when the user hasn't configured a value. */
const AUTO_SETUP_DEFAULTS = {
	"remote.SSH.reconnectionGraceTime": 28800, // 8h
	"remote.SSH.serverShutdownTimeout": 28800, // 8h
	"remote.SSH.maxReconnectionAttempts": null, // max allowed
} as const satisfies Partial<Record<SshSettingKey, number | null>>;

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
	const connTimeoutKey: SshSettingKey = "remote.SSH.connectTimeout";
	const { value: minConnTimeout } = RECOMMENDED_SSH_SETTINGS[connTimeoutKey];
	const connTimeout = config.get<number>(connTimeoutKey);
	if (minConnTimeout && (!connTimeout || connTimeout < minConnTimeout)) {
		overrides.push({ key: connTimeoutKey, value: minConnTimeout });
	}

	// Set conservative defaults for settings the user hasn't configured.
	for (const [key, value] of Object.entries(AUTO_SETUP_DEFAULTS)) {
		if (config.get(key) === undefined) {
			overrides.push({ key, value });
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
