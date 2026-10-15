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
 * The win32 branch targets Windows OpenSSH, which starts `ProxyCommand`
 * without a shell: `%%` becomes `%` and the CLI splits the line with the
 * Windows argv rules (`\"`). Git Bash's `sh` still expands `$` inside.
 */
export function escapeShellArg(arg: string): string {
	if (os.platform() === "win32") {
		// `\\+` consumes backslash runs not before a quote, keeping this linear.
		const escaped = arg
			.replace(/(\\*)("|$)|\\+/g, (run, slashes?: string, quote?: string) =>
				slashes === undefined
					? run
					: `${slashes}${slashes}${quote ? '\\"' : ""}`,
			)
			.replace(/%/g, "%%");
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

/**
 * {@link escapeProxyCommandArg} for a local path. Windows drive paths use `/`,
 * which every runner accepts; open-remote-ssh 0.4.0 strips `\` as an escape.
 */
export function escapeProxyCommandPath(filePath: string): string {
	const portable =
		os.platform() === "win32" && /^[a-z]:\\/i.test(filePath)
			? filePath.replaceAll("\\", "/")
			: filePath;
	return escapeProxyCommandArg(portable);
}
