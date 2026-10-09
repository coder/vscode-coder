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
