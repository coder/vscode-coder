import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";

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
 * Write a cross-platform executable that runs the given JS code.
 * On Unix creates a shebang script; on Windows creates a .cmd wrapper.
 * Returns the path to the executable.
 */
export async function writeExecutable(
	dir: string,
	name: string,
	code: string,
): Promise<string> {
	if (isWindows()) {
		const jsPath = path.join(dir, `${name}.js`);
		const cmdPath = path.join(dir, `${name}.cmd`);
		await fs.writeFile(jsPath, code);
		await fs.writeFile(cmdPath, `@node "${jsPath}" %*\r\n`);
		return cmdPath;
	}

	const binPath = path.join(dir, name);
	await fs.writeFile(binPath, `#!/usr/bin/env node\n${code}`);
	await fs.chmod(binPath, "755");
	return binPath;
}

export function expectPathsEqual(actual: string, expected: string) {
	expect(normalizePath(actual)).toBe(normalizePath(expected));
}

function normalizePath(p: string): string {
	return p.replaceAll(path.sep, path.posix.sep);
}
