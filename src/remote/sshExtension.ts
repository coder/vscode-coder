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
