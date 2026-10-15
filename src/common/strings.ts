import os from "node:os";

/** `toLowerCase` typed for indexing `Lowercase`-keyed records without a cast. */
export function lowercase<T extends string>(value: T): Lowercase<T> {
	return value.toLowerCase() as Lowercase<T>;
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
 * A leading, trailing or doubled `=` is quoted too: open-remote-ssh's
 * ssh-config@5 treats an unquoted `=` as a separator.
 *
 * @see https://docs.python.org/3/library/shlex.html#shlex.quote
 * @see https://learn.microsoft.com/en-us/archive/blogs/twistylittlepassagesallalike/everyone-quotes-command-line-arguments-the-wrong-way
 */
export function escapeCommandArg(arg: string): string {
	if (/^[\w@%+,:./-]+(?:=[\w@%+,:./-]+)*$/.test(arg)) {
		return arg;
	}
	return `"${arg.replaceAll('"', String.raw`\"`)}"`;
}

/**
 * Cross-platform shell quoting that blocks variable expansion. Use for
 * values from outside the user's local settings (e.g. server-controlled).
 * The win32 branch targets Windows OpenSSH, which runs `ProxyCommand`
 * without a shell and turns `%%` back into `%`. A shell such as cmd.exe or
 * Git Bash's `sh` still expands inside those quotes.
 */
export function escapeShellArg(arg: string): string {
	if (os.platform() === "win32") {
		const escaped = arg.replace(/"/g, '""').replace(/%/g, "%%");
		return `"${escaped}"`;
	}
	return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Double quotes read the same in a shell and in open-remote-ssh, which splits
 * `ProxyCommand` itself, unless the value needs escaping there.
 */
export function escapeProxyCommandArg(arg: string): string {
	return /[$`\\%\r\n]/.test(arg) ? escapeShellArg(arg) : escapeCommandArg(arg);
}
