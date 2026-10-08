import { formatDuration, intervalToDuration } from "date-fns";
import * as jsonc from "jsonc-parser";
import * as fs from "node:fs/promises";

import {
	getRemoteSshExtension,
	type RemoteSshExtensionId,
} from "./sshExtension";

import type { WorkspaceConfiguration } from "vscode";

import type { Logger } from "../logging/logger";

export interface SettingOverride {
	readonly key: string;
	readonly value: unknown;
}

interface RecommendedSetting {
	readonly value: number | null;
	readonly label: string;
}

const MIN_CONNECT_TIMEOUT = 1800;

/**
 * Applied by the "Apply Recommended SSH Settings" command.
 * These are more aggressive (24h) than AUTO_SETUP_DEFAULTS (8h) because the
 * user is explicitly opting in via the command palette.
 */
const RECOMMENDED_SSH_SETTINGS = {
	connectTimeout: recommended("Connect Timeout", MIN_CONNECT_TIMEOUT),
	reconnectionGraceTime: recommended("Reconnection Grace Time", 86400),
	serverShutdownTimeout: recommended("Server Shutdown Timeout", 86400),
	maxReconnectionAttempts: recommended("Max Reconnection Attempts", null),
} as const satisfies Readonly<Record<string, RecommendedSetting>>;

type SshSettingKey = keyof typeof RECOMMENDED_SSH_SETTINGS;

/** Defaults set during connection when the user hasn't configured a value. */
const AUTO_SETUP_DEFAULTS = {
	reconnectionGraceTime: 28800, // 8h
	serverShutdownTimeout: 28800, // 8h
	maxReconnectionAttempts: null, // max allowed
} as const satisfies Readonly<
	Record<Exclude<SshSettingKey, "connectTimeout">, number | null>
>;

const PROVIDER_SETTINGS = {
	"ms-vscode-remote.remote-ssh": [
		"connectTimeout",
		"reconnectionGraceTime",
		"maxReconnectionAttempts",
	],
	"anysphere.remote-ssh": ["connectTimeout", "serverShutdownTimeout"],
	"jeanp413.open-remote-ssh": ["connectTimeout"],
	"codeium.windsurf-remote-openssh": [
		"connectTimeout",
		"reconnectionGraceTime",
		"maxReconnectionAttempts",
	],
	"google.antigravity-remote-openssh": [],
} as const satisfies Readonly<
	Record<RemoteSshExtensionId, readonly SshSettingKey[]>
>;

export function getRecommendedSshSettings(
	config: Pick<WorkspaceConfiguration, "inspect">,
): Readonly<Record<string, RecommendedSetting>> {
	return Object.fromEntries(
		getSshSettings(config).map(({ name, key }) => [
			key,
			RECOMMENDED_SSH_SETTINGS[name],
		]),
	);
}

/**
 * Build the list of VS Code setting overrides needed for a remote SSH
 * connection to a Coder workspace.
 */
export function buildSshOverrides(
	config: Pick<WorkspaceConfiguration, "get" | "inspect">,
	sshHost: string,
	agentOS: string,
	remoteCommand: string | undefined,
	logger: Logger,
): SettingOverride[] {
	const overrides: SettingOverride[] = [];

	// When enableRemoteCommand is true and the host has an active
	// RemoteCommand, we must not set remotePlatform: it causes VS Code
	// to append 'bash', which conflicts with RemoteCommand. We gate on
	// enableRemoteCommand so users who haven't opted in don't get an
	// unexpected platform prompt.
	const enableRemoteCommand = config.get<boolean>(
		"remote.SSH.enableRemoteCommand",
		false,
	);
	const skipRemotePlatform =
		enableRemoteCommand && isActiveRemoteCommand(remoteCommand);

	const remotePlatforms = config.get<Record<string, string>>(
		"remote.SSH.remotePlatform",
		{},
	);
	if (skipRemotePlatform) {
		logger.info("RemoteCommand detected, skipping remotePlatform override");
		// Remove any stale entry so it doesn't block RemoteCommand.
		if (sshHost in remotePlatforms) {
			const { [sshHost]: _removed, ...rest } = remotePlatforms;
			overrides.push({
				key: "remote.SSH.remotePlatform",
				value: rest,
			});
		}
	} else if (remotePlatforms[sshHost] !== agentOS) {
		// Set the remote platform to bypass the platform prompt.
		overrides.push({
			key: "remote.SSH.remotePlatform",
			value: { ...remotePlatforms, [sshHost]: agentOS },
		});
	}

	for (const { name, key } of getSshSettings(config)) {
		const effectiveKey = effectiveSettingKey(config, key);
		if (name === "connectTimeout") {
			// Default 15s is too short for startup scripts; enforce a minimum.
			const timeout = config.get<number>(effectiveKey);
			if (!timeout || timeout < MIN_CONNECT_TIMEOUT) {
				overrides.push({ key, value: MIN_CONNECT_TIMEOUT });
			}
			continue;
		}
		if (
			effectiveKey !== key ||
			config.inspect(key)?.globalValue !== undefined
		) {
			continue;
		}
		const value = AUTO_SETUP_DEFAULTS[name];
		// VS Code inspect() reports explicit null values as undefined.
		if (value === null && config.get(key) === null) {
			continue;
		}
		overrides.push({ key, value });
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
	overrides: readonly SettingOverride[],
	logger: Logger,
): Promise<boolean> {
	if (overrides.length === 0) {
		return true;
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

function getSshSettings(config: Pick<WorkspaceConfiguration, "inspect">) {
	const extensionId = getRemoteSshExtension()?.id;
	if (!extensionId) return [];
	const namespace =
		extensionId === "codeium.windsurf-remote-openssh"
			? (["remote.devinSSH", "remote.windsurfSSH"] as const).find(
					(candidate) =>
						config.inspect(`${candidate}.connectTimeout`)?.defaultValue !==
						undefined,
				)
			: "remote.SSH";
	if (!namespace) return [];
	return PROVIDER_SETTINGS[extensionId].map(
		(name) => ({ name, key: `${namespace}.${name}` }) as const,
	);
}

/** Devin reads deprecated Windsurf values only when its own key is unset. */
function effectiveSettingKey(
	config: Pick<WorkspaceConfiguration, "inspect">,
	key: string,
): string {
	if (!key.startsWith("remote.devinSSH.")) return key;
	if (hasExplicitValue(config.inspect(key))) return key;
	const fallbackKey = key.replace("remote.devinSSH.", "remote.windsurfSSH.");
	return hasExplicitValue(config.inspect(fallbackKey)) ? fallbackKey : key;
}

function hasExplicitValue(
	setting: ReturnType<WorkspaceConfiguration["inspect"]>,
): boolean {
	return (
		setting !== undefined &&
		(setting.globalValue !== undefined ||
			setting.workspaceValue !== undefined ||
			setting.workspaceFolderValue !== undefined)
	);
}

/**
 * Whether the given RemoteCommand value represents an active command
 * (i.e. present, non-empty, and not the SSH default "none").
 */
function isActiveRemoteCommand(cmd: string | undefined): boolean {
	return !!cmd && cmd.toLowerCase() !== "none";
}

function recommended(
	shortName: string,
	value: number | null,
): RecommendedSetting {
	const description =
		value === null
			? "max allowed"
			: formatDuration(intervalToDuration({ start: 0, end: value * 1000 }));
	return { value, label: `${shortName}: ${description}` };
}
