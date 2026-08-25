import * as vscode from "vscode";

import { toSafeHost } from "./uri";

/** The editor every host was named after before per-editor prefixes existed. */
export const LegacyEditorId = "vscode";
export const LegacyAuthorityPrefix = `coder-${LegacyEditorId}`;

export interface AuthorityParts {
	agent: string | undefined;
	/** The `coder-<editor>.<safeHostname>--` prefix of the parsed host. */
	hostPrefix: string;
	sshHost: string;
	safeHostname: string;
	username: string;
	workspace: string;
}

export type AuthorityClassification = "current" | "legacy" | "foreign";

const sshRemotePrefix = "ssh-remote+";
const invalidAuthorityMessage =
	"Invalid Coder SSH authority. Must be: <hostname>--<username>--<workspace>(.<agent?>)";

/** This editor's identity, keeping its SSH hosts and files apart from other editors'. */
export function currentEditorId(): string {
	const uriScheme = vscode.env.uriScheme;
	if (!uriScheme) {
		throw new Error("Editor URI scheme must not be empty.");
	}
	return uriScheme;
}

function currentAuthorityPrefix(): string {
	return `coder-${currentEditorId()}`;
}

/**
 * Returns an offset, not the host, because retargeting rewrites the prefix in
 * place. A nested authority puts the SSH remote last.
 */
function getSshHostStart(authority: string): number | undefined {
	if (authority.startsWith(sshRemotePrefix)) {
		return sshRemotePrefix.length;
	}

	for (const wrapper of [`@${sshRemotePrefix}`, `://${sshRemotePrefix}`]) {
		const index = authority.lastIndexOf(wrapper);
		if (index !== -1) {
			return index + wrapper.length;
		}
	}

	return undefined;
}

export function classifySshHost(sshHost: string): AuthorityClassification {
	const currentPrefix = currentAuthorityPrefix();
	if (sshHost.startsWith(`${currentPrefix}.`)) {
		return "current";
	}
	if (
		currentPrefix !== LegacyAuthorityPrefix &&
		sshHost.startsWith(`${LegacyAuthorityPrefix}.`)
	) {
		return "legacy";
	}
	// Anything else is foreign, including deployment-unaware hosts like
	// coder-vscode--ws; their preserved config block still routes them.
	return "foreign";
}

function editorIdFor(classification: AuthorityClassification): string {
	return classification === "legacy" ? LegacyEditorId : currentEditorId();
}

/** Editor named in a host's prefix; legacy hosts stay VS Code's in any editor. */
export function hostEditorId(sshHost: string): string {
	return editorIdFor(classifySshHost(sshHost));
}

/**
 * Given an authority, parse into the expected parts.
 *
 * Authorities arrive without a scheme from `env.remoteAuthority` and
 * `Uri.authority`, as `ssh-remote+<ssh host name>` or nested behind another
 * remote, like `dev-container+abc@ssh-remote+<ssh host name>`. The SSH host
 * names created by this extension match the format:
 *   coder-<editor>.<safeHostname>--<username>--<workspace>(.<agent?>)
 *
 * If this is not a Coder authority, return null.
 *
 * Throw an error if a Coder authority is invalid.
 */
export function parseRemoteAuthority(authority: string): AuthorityParts | null {
	const sshHostStart = getSshHostStart(authority);
	if (sshHostStart === undefined) {
		return null;
	}

	const sshHost = authority.slice(sshHostStart);
	const classification = classifySshHost(sshHost);
	if (classification === "foreign") {
		return null;
	}

	// The classification guarantees the host starts with "<prefix>.".
	const prefix = `coder-${editorIdFor(classification)}.`;
	const parts = sshHost.slice(prefix.length).split("--");
	if (parts.length < 3) {
		throw new Error(invalidAuthorityMessage);
	}

	// Parse from the right because safe hostnames can contain "--".
	const safeHostname = parts.slice(0, -2).join("--");
	const username = parts[parts.length - 2];
	const workspaceAndAgent = parts[parts.length - 1];
	if (!safeHostname || !username || !workspaceAndAgent) {
		throw new Error(invalidAuthorityMessage);
	}

	let workspace = workspaceAndAgent;
	let agent = "";
	const workspaceParts = workspaceAndAgent.split(".");
	// Multiple dots are ambiguous because workspace and agent share this separator.
	if (workspaceParts.length === 2) {
		workspace = workspaceParts[0];
		agent = workspaceParts[1];
		if (!workspace || !agent) {
			throw new Error(invalidAuthorityMessage);
		}
	}

	return {
		agent,
		hostPrefix: `${prefix}${safeHostname}--`,
		sshHost,
		safeHostname,
		username,
		workspace,
	};
}

export function toRemoteAuthority(
	baseUrl: string,
	workspaceOwner: string,
	workspaceName: string,
	workspaceAgent: string | undefined,
): string {
	let remoteAuthority = `ssh-remote+${currentAuthorityPrefix()}.${toSafeHost(baseUrl)}--${workspaceOwner}--${workspaceName}`;
	if (workspaceAgent) {
		remoteAuthority += `.${workspaceAgent}`;
	}
	return remoteAuthority;
}

export function retargetRemoteAuthority(authority: string): string {
	const sshHostStart = getSshHostStart(authority);
	if (sshHostStart === undefined) {
		return authority;
	}

	const sshHost = authority.slice(sshHostStart);
	if (classifySshHost(sshHost) !== "legacy") {
		return authority;
	}
	return `${authority.slice(0, sshHostStart)}${currentAuthorityPrefix()}${sshHost.slice(LegacyAuthorityPrefix.length)}`;
}

export function isRemoteAuthorityCompatible(
	authority: string | undefined,
	targetAuthority: string,
): boolean {
	if (!authority) {
		return false;
	}
	return (
		authority === targetAuthority ||
		retargetRemoteAuthority(authority) === targetAuthority
	);
}
