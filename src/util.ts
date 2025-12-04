import * as os from "node:os";
import url from "node:url";

export interface AuthorityParts {
	agent: string | undefined;
	host: string;
	label: string;
	username: string;
	workspace: string;
}

// Prefix is a magic string that is prepended to SSH hosts to indicate that
// they should be handled by this extension.
export const AuthorityPrefix = "coder-vscode";

// Regex patterns to find the SSH port from Remote SSH extension logs.
// `ms-vscode-remote.remote-ssh`: `-> socksPort <port> ->` or `between local port <port>`
// `codeium.windsurf-remote-openssh`, `jeanp413.open-remote-ssh`, `google.antigravity-remote-openssh`: `=> <port>(socks) =>`
// `anysphere.remote-ssh`: `Socks port: <port>`
export const RemoteSSHLogPortRegex =
	/(?:-> socksPort (\d+) ->|between local port (\d+)|=> (\d+)\(socks\) =>|Socks port: (\d+))/g;

/**
 * Given the contents of a Remote - SSH log file, find the most recent port
 * number used by the SSH process. This is typically the socks port, but the
 * local port works too.
 *
 * Returns null if no port is found.
 */
export function findPort(text: string): number | null {
	const allMatches = [...text.matchAll(RemoteSSHLogPortRegex)];
	if (allMatches.length === 0) {
		return null;
	}

	// Get the last match, which is the most recent port.
	const lastMatch = allMatches.at(-1)!;
	// Each capture group corresponds to a different Remote SSH extension log format:
	// [0] full match, [1] and [2] ms-vscode-remote.remote-ssh,
	// [3] windsurf/open-remote-ssh/antigravity, [4] anysphere.remote-ssh
	const portStr = lastMatch[1] || lastMatch[2] || lastMatch[3] || lastMatch[4];
	if (!portStr) {
		return null;
	}

	return Number.parseInt(portStr);
}

/**
 * Given an authority, parse into the expected parts.
 *
 * If this is not a Coder host, return null.
 *
 * Throw an error if the host is invalid.
 */
export function parseRemoteAuthority(authority: string): AuthorityParts | null {
	// The authority looks like: vscode://ssh-remote+<ssh host name>
	const authorityParts = authority.split("+");

	// We create SSH host names in a format matching:
	// coder-vscode(--|.)<username>--<workspace>(--|.)<agent?>
	// The agent can be omitted; the user will be prompted for it instead.
	// Anything else is unrelated to Coder and can be ignored.
	const parts = authorityParts[1].split("--");
	if (
		parts.length <= 1 ||
		(parts[0] !== AuthorityPrefix &&
			!parts[0].startsWith(`${AuthorityPrefix}.`))
	) {
		return null;
	}

	// It has the proper prefix, so this is probably a Coder host name.
	// Validate the SSH host name.  Including the prefix, we expect at least
	// three parts, or four if including the agent.
	if ((parts.length !== 3 && parts.length !== 4) || parts.some((p) => !p)) {
		throw new Error(
			`Invalid Coder SSH authority. Must be: <username>--<workspace>(--|.)<agent?>`,
		);
	}

	let workspace = parts[2];
	let agent = "";
	if (parts.length === 4) {
		agent = parts[3];
	} else if (parts.length === 3) {
		const workspaceParts = parts[2].split(".");
		if (workspaceParts.length === 2) {
			workspace = workspaceParts[0];
			agent = workspaceParts[1];
		}
	}

	return {
		agent: agent,
		host: authorityParts[1],
		label: parts[0].replace(/^coder-vscode\.?/, ""),
		username: parts[1],
		workspace: workspace,
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

/**
 * Given a URL, return the host in a format that is safe to write.
 */
export function toSafeHost(rawUrl: string): string {
	const u = new URL(rawUrl);
	// If the host is invalid, an empty string is returned.  Although, `new URL`
	// should already have thrown in that case.
	return url.domainToASCII(u.hostname) || u.hostname;
}

/**
 * Expand a path if it starts with tilde (~) or contains ${userHome}.
 */
export function expandPath(input: string): string {
	const userHome = os.homedir();
	if (input.startsWith("~")) {
		input = userHome + input.substring("~".length);
	}
	return input.replaceAll("${userHome}", userHome);
}

/**
 * Return the number of times a substring appears in a string.
 */
export function countSubstring(needle: string, haystack: string): number {
	if (needle.length < 1 || haystack.length < 1) {
		return 0;
	}
	let count = 0;
	let pos = haystack.indexOf(needle);
	while (pos !== -1) {
		count++;
		pos = haystack.indexOf(needle, pos + needle.length);
	}
	return count;
}

export function escapeCommandArg(arg: string): string {
	const escapedString = arg.replaceAll('"', String.raw`\"`);
	return `"${escapedString}"`;
}
