import * as vscode from "vscode";

export const REMOTE_SSH_EXTENSION_IDS = [
	"jeanp413.open-remote-ssh",
	"codeium.windsurf-remote-openssh",
	"anysphere.remote-ssh",
	"ms-vscode-remote.remote-ssh",
	"google.antigravity-remote-openssh",
] as const;

export type RemoteSshExtensionId = (typeof REMOTE_SSH_EXTENSION_IDS)[number];

/**
 * Sections each extension reads, in order. The rebranded forks renamed the
 * whole `remote.SSH` section, so reading it directly misses them.
 */
const SETTING_SECTIONS: Readonly<
	Record<RemoteSshExtensionId, readonly string[]>
> = {
	"jeanp413.open-remote-ssh": ["remote.SSH"],
	// Windsurf became Devin and reads both, preferring the new name.
	"codeium.windsurf-remote-openssh": ["remote.devinSSH", "remote.windsurfSSH"],
	"anysphere.remote-ssh": ["remote.SSH"],
	"ms-vscode-remote.remote-ssh": ["remote.SSH"],
	"google.antigravity-remote-openssh": ["remote.antigravitySSH"],
};

/** First non-empty value for a string setting, e.g. `configFile`. */
export function getRemoteSshSetting(key: string): string | undefined {
	const id = getRemoteSshExtension()?.id;
	const sections = id ? SETTING_SECTIONS[id] : ["remote.SSH"];
	for (const section of sections) {
		const value = vscode.workspace.getConfiguration(section).get<string>(key);
		if (value) {
			return value;
		}
	}
	return undefined;
}

/**
 * VS Code Remote-SSH log layout, shared by the live SSH monitor and the
 * support-bundle collector so a future layout change updates one place.
 */
const OUTPUT_LOGGING_DIR_PREFIX = "output_logging_";
const REMOTE_SSH_LOG_NAME_FRAGMENT = "Remote - SSH";

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

type RemoteSshExtension = vscode.Extension<unknown> & {
	id: RemoteSshExtensionId;
};

export function getRemoteSshExtension(): RemoteSshExtension | undefined {
	for (const id of REMOTE_SSH_EXTENSION_IDS) {
		const extension = vscode.extensions.getExtension(id);
		if (extension) {
			return extension as RemoteSshExtension;
		}
	}
	return undefined;
}
