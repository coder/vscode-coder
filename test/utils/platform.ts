import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {expect} from "vitest";

import type * as cp from "node:child_process";

export function isWindows(): boolean {
	return os.platform() === "win32";
}

/**
 * Returns a platform-independent command that outputs the given text.
 * Uses Node.js which is guaranteed to be available during tests.
 */
export function printCommand(output: string): string {
	const escaped = output
		.replace(/\\/g, "\\\\") // Escape backslashes first
		.replace(/'/g, "\\'") // Escape single quotes
		.replace(/"/g, '\\"') // Escape double quotes
		.replace(/\r/g, "\\r") // Preserve carriage returns
		.replace(/\n/g, "\\n"); // Preserve newlines

	return `node -e "process.stdout.write('${escaped}')"`;
}

/**
 * Returns a platform-independent command that exits with the given code.
 */
export function exitCommand(code: number): string {
	return `node -e "process.exit(${code})"`;
}

/**
 * Returns a platform-independent command that prints an environment variable.
 * @param key The key for the header (e.g., "url" to output "url=value")
 * @param varName The environment variable name to access
 */
export function printEnvCommand(key: string, varName: string): string {
	return `node -e "process.stdout.write('${key}=' + process.env.${varName})"`;
}

/**
 * Write a JS file that can be executed cross-platform.
 * Tests that use `execFile` on the returned path should apply
 * {@link shimExecFile} so `.js` files are run through `process.execPath`.
 */
export async function writeExecutable(
	dir: string,
	name: string,
	code: string,
): Promise<string> {
	const jsPath = path.join(dir, `${name}.js`);
	await fs.writeFile(jsPath, code);
	return jsPath;
}

/**
 * If `file` is a `.js` path, prepend it into the args array and swap the
 * binary to `process.execPath` so `execFile` works on every platform
 * (Windows cannot `execFile` script wrappers).
 */
function prepend(file: string, rest: unknown[]): [string, ...unknown[]] {
	if (!file.endsWith(".js")) return [file, ...rest];
	if (Array.isArray(rest[0])) {
		return [process.execPath, [file, ...rest[0]], ...rest.slice(1)];
	}
	return [process.execPath, [file], ...rest];
}

/**
 * Shim `child_process.execFile` so `.js` files are launched through node.
 * Use with `vi.mock`:
 *
 * ```ts
 * vi.mock("node:child_process", async (importOriginal) => {
 *   const { shimExecFile } = await import("../../utils/platform");
 *   return shimExecFile(await importOriginal());
 * });
 * ```
 */
export function shimExecFile<M extends {execFile: (...args: never[]) => unknown}>(mod: M): M {
	const {execFile: original} = mod;

	function execFile(file: string, ...rest: unknown[]): cp.ChildProcess {
		return Reflect.apply(original, undefined, prepend(file, rest));
	}

	return Object.assign({}, mod, {execFile});
}

export function expectPathsEqual(actual: string, expected: string) {
	expect(normalizePath(actual)).toBe(normalizePath(expected));
}

function normalizePath(p: string): string {
	return p.replaceAll(path.sep, path.posix.sep);
}
