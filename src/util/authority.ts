import { toSafeHost } from "./uri";

export interface AuthorityParts {
	agent: string | undefined;
	sshHost: string;
	safeHostname: string;
	username: string;
	workspace: string;
}

// Prefix is a magic string that is prepended to SSH hosts to indicate that
// they should be handled by this extension.
export const AuthorityPrefix = "coder-vscode";

const authorityHostPrefix = `${AuthorityPrefix}.`;
const invalidAuthorityMessage =
	"Invalid Coder SSH authority. Must be: <hostname>--<username>--<workspace>(.<agent?>)";

/**
 * Given an authority, parse into the expected parts.
 *
 * The authority looks like `<scheme>://ssh-remote+<ssh host name>`, where the
 * SSH host names created by this extension match the format:
 *   coder-vscode.<safeHostname>--<username>--<workspace>(.<agent?>)
 *
 * If this is not a Coder authority, return null.
 *
 * Throw an error if a Coder authority is invalid.
 */
export function parseRemoteAuthority(authority: string): AuthorityParts | null {
	const authorityParts = authority.split("+");
	const sshHost = authorityParts[1];
	if (!sshHost) {
		return null;
	}

	const parts = sshHost.split("--");
	if (!parts[0].startsWith(authorityHostPrefix)) {
		return null;
	}

	if (parts.length < 3) {
		throw new Error(invalidAuthorityMessage);
	}

	// Parse from the right because safe hostnames can contain "--".
	const hostPrefix = parts.slice(0, -2).join("--");
	const safeHostname = hostPrefix.slice(authorityHostPrefix.length);
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
	let remoteAuthority = `ssh-remote+${AuthorityPrefix}.${toSafeHost(baseUrl)}--${workspaceOwner}--${workspaceName}`;
	if (workspaceAgent) {
		remoteAuthority += `.${workspaceAgent}`;
	}
	return remoteAuthority;
}
