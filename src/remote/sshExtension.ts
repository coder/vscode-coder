import * as fs from "node:fs";
import * as path from "node:path";
import * as semver from "semver";
import * as vscode from "vscode";

import { expandPath } from "../common/fs";

import type { WorkspaceConfiguration } from "vscode";

export const REMOTE_SSH_EXTENSION_IDS = [
	"jeanp413.open-remote-ssh",
	"codeium.windsurf-remote-openssh",
	"anysphere.remote-ssh",
	"ms-vscode-remote.remote-ssh",
	"google.antigravity-remote-openssh",
] as const;

/**
 * VS Code Remote-SSH log layout, shared by the live SSH monitor and the
 * support-bundle collector so a future layout change updates one place.
 */
const OUTPUT_LOGGING_DIR_PREFIX = "output_logging_";
const REMOTE_SSH_LOG_NAME_FRAGMENT = "Remote - SSH";

const DEVIN_CONFIG_FILE_VERSION = "3.12.32";

export type RemoteSshExtensionId = (typeof REMOTE_SSH_EXTENSION_IDS)[number];

type RemoteSshExtension = vscode.Extension<unknown> & {
	id: RemoteSshExtensionId;
};

/**
 * The SSH config file the active extension passes to ssh with `-F`, if any.
 * Antigravity reads its own setting but never passes it.
 */
export function getRemoteSshConfigFile(): string | undefined {
	const config = vscode.workspace.getConfiguration();
	switch (getRemoteSshExtension()?.id) {
		case "google.antigravity-remote-openssh":
			return undefined;
		case "codeium.windsurf-remote-openssh":
			return devinPassesConfigFile()
				? getPath(
						config,
						devinOrWindsurfKey(config, "remote.devinSSH.configFile"),
					)
				: undefined;
		default:
			return getPath(config, "remote.SSH.configFile");
	}
}

/** The ssh executable the active extension launches, if one is configured. */
export function getRemoteSshPath(): string | undefined {
	const config = vscode.workspace.getConfiguration();
	switch (getRemoteSshExtension()?.id) {
		case "google.antigravity-remote-openssh":
			return getPath(config, "remote.antigravitySSH.path");
		case "codeium.windsurf-remote-openssh":
			return getPath(
				config,
				devinOrWindsurfKey(config, "remote.devinSSH.path"),
			);
		case "jeanp413.open-remote-ssh":
			// Its default `ssh2` backend is a JavaScript client with no ssh binary.
			return config.get("remote.SSH.connectionBackend") === "native"
				? getPath(config, "remote.SSH.path")
				: undefined;
		default:
			return getPath(config, "remote.SSH.path");
	}
}

/** Devin reads deprecated Windsurf values only when its own key is unset. */
export function devinOrWindsurfKey(
	config: Pick<WorkspaceConfiguration, "inspect">,
	key: string,
): string {
	if (
		!key.startsWith("remote.devinSSH.") ||
		hasExplicitValue(config.inspect(key))
	) {
		return key;
	}
	const fallbackKey = key.replace("remote.devinSSH.", "remote.windsurfSSH.");
	return hasExplicitValue(config.inspect(fallbackKey)) ? fallbackKey : key;
}

/** True if `dirName` is the exthost dir of a known Remote-SSH extension. */
export function isRemoteSshExtensionDir(dirName: string): boolean {
	return (REMOTE_SSH_EXTENSION_IDS as readonly string[]).includes(dirName);
}

/** True if `dirName` is a VS Code shared output channel dir. */
export function isOutputLoggingDir(dirName: string): boolean {
	return dirName.startsWith(OUTPUT_LOGGING_DIR_PREFIX);
}

/** True if `fileName` is the Remote-SSH log inside a shared output channel. */
export function isSharedChannelRemoteSshLog(fileName: string): boolean {
	return fileName.includes(REMOTE_SSH_LOG_NAME_FRAGMENT);
}

export function getRemoteSshExtension(): RemoteSshExtension | undefined {
	for (const id of REMOTE_SSH_EXTENSION_IDS) {
		const extension = vscode.extensions.getExtension(id);
		if (extension) {
			return extension as RemoteSshExtension;
		}
	}
	return undefined;
}

function getPath(
	config: Pick<WorkspaceConfiguration, "get">,
	key: string,
): string | undefined {
	const value = config.get<string>(key);
	return value ? expandPath(value) : undefined;
}

/**
 * Its extension is always 0.0.1, so check the editor's version.
 * https://docs.devin.ai/desktop/changelog#v3-12-32
 */
function devinPassesConfigFile(): boolean {
	try {
		const product = fs.readFileSync(
			path.join(vscode.env.appRoot, "product.json"),
			"utf8",
		);
		const { windsurfVersion } = JSON.parse(product) as {
			windsurfVersion?: unknown;
		};
		return (
			typeof windsurfVersion === "string" &&
			semver.gte(windsurfVersion, DEVIN_CONFIG_FILE_VERSION)
		);
	} catch {
		return false;
	}
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
