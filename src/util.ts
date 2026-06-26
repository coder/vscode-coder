import os from "node:os";

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
