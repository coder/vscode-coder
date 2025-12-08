import * as vscode from "vscode";

export const REMOTE_SSH_EXTENSION_IDS = [
	"jeanp413.open-remote-ssh",
	"codeium.windsurf-remote-openssh",
	"anysphere.remote-ssh",
	"ms-vscode-remote.remote-ssh",
	"google.antigravity-remote-openssh",
] as const;

export type RemoteSshExtensionId = (typeof REMOTE_SSH_EXTENSION_IDS)[number];

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
