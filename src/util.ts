import os from "node:os";
import url from "node:url";
import * as vscode from "vscode";

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
	const lastMatch = allMatches[allMatches.length - 1];
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
 * The authority looks like `<scheme>://ssh-remote+<ssh host name>`, where the
 * SSH host names created by this extension match the format:
 *   coder-vscode.<safeHostname>--<username>--<workspace>(.<agent?>)
 *
 * If this is not a Coder host, return null.
 *
 * Throw an error if the host is invalid.
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
 * Substitute `${env:VAR}` with `process.env.VAR` (unset → empty string),
 * `${userHome}` (anywhere) with `os.homedir()`, and a leading `~` with
 * `os.homedir()`. Env substitution runs first so env values can themselves
 * contain `~` or `${userHome}`.
 */
export function expandPath(input: string): string {
	const expanded = input.replace(
		/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,
		(_, name: string) => process.env[name] ?? "",
	);
	const userHome = os.homedir();
	const tildeExpanded = expanded.startsWith("~")
		? userHome + expanded.substring("~".length)
		: expanded;
	return tildeExpanded.replaceAll("${userHome}", userHome);
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

/**
 * Wraps `arg` in `"..."` unless every character is in the shell-safe
 * whitelist (matching Python `shlex.quote`'s set: alphanumerics plus
 * `@%+,=:./-`). Anything else (whitespace, `"`, `&|;()<>*?[~#!^\` `$`)
 * forces quoting so the output is a single token in POSIX `sh`, cmd.exe,
 * and PowerShell.
 *
 * Not a universal shell-escape: `$VAR` / `$(...)` / `%VAR%` still expand
 * inside `"..."`. For untrusted values use {@link escapeShellArg}.
 *
 * @see https://docs.python.org/3/library/shlex.html#shlex.quote
 * @see https://learn.microsoft.com/en-us/archive/blogs/twistylittlepassagesallalike/everyone-quotes-command-line-arguments-the-wrong-way
 */
export function escapeCommandArg(arg: string): string {
	if (arg !== "" && /^[\w@%+,=:./-]+$/.test(arg)) {
		return arg;
	}
	return `"${arg.replaceAll('"', String.raw`\"`)}"`;
}

/**
 * Cross-platform shell quoting that blocks variable expansion. Use for
 * values from outside the user's local settings (e.g. server-controlled).
 */
export function escapeShellArg(arg: string): string {
	if (os.platform() === "win32") {
		const escaped = arg.replace(/"/g, '""').replace(/%/g, "%%");
		return `"${escaped}"`;
	}
	return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Return the URL for opening Coder pages in the browser.  Uses the
 * `coder.alternativeWebUrl` setting when configured, otherwise returns
 * the connection URL unchanged.
 */
export function resolveBrowserUrl(connectionUrl: string): string {
	const alt = vscode.workspace
		.getConfiguration("coder")
		.get<string>("alternativeWebUrl")
		?.trim()
		.replace(/\/+$/, "");
	return alt || connectionUrl;
}
