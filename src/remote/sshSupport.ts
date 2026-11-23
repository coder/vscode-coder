import * as childProcess from "child_process";
import { promisify } from "node:util";

import { escapeRegExp, lowercase } from "../common/strings";
import { getCliProcessEnv } from "../settings/cli";

const execFile = promisify(childProcess.execFile);

const RESOLVE_TIMEOUT_MS = 5_000;

/** OpenSSH `Host` pattern: `*` matches any run of characters, `?` exactly one. */
function matchesHostPattern(host: string, pattern: string): boolean {
	const source = Array.from(pattern, (char) => {
		if (char === "*") {
			return ".*";
		}
		if (char === "?") {
			return ".";
		}
		return escapeRegExp(char);
	}).join("");
	return new RegExp(`^${source}$`).test(host);
}

/** Keyed by lowercase directive name, so wrong-cased lookups fail to compile. */
export type SshProperties = Record<Lowercase<string>, string>;

/**
 * Effective SSH properties for a host as OpenSSH resolves them (`ssh -G`),
 * following Include and Match. Runs `sshPath`, or `ssh` on PATH when unset.
 * @throws {Error} when ssh is a Windows batch file (which needs a shell),
 * fails, times out, or resolves no ProxyCommand, meaning it never read the
 * Coder config (a different ssh build or home directory).
 */
export async function resolveSshProperties(
	sshPath: string | undefined,
	host: string,
	configFile: string | undefined,
): Promise<SshProperties> {
	const ssh = sshPath || "ssh";
	if (process.platform === "win32" && /\.(bat|cmd)$/i.test(ssh)) {
		throw new Error(`${ssh} is a batch file, which needs a shell to run`);
	}
	const configArgs = configFile ? ["-F", configFile] : [];
	const { stdout } = await execFile(ssh, ["-G", ...configArgs, "--", host], {
		env: getCliProcessEnv(),
		timeout: RESOLVE_TIMEOUT_MS,
	});

	const properties: SshProperties = {};
	for (const line of stdout.split(/\r?\n/)) {
		const space = line.indexOf(" ");
		if (space > 0) {
			properties[lowercase(line.slice(0, space))] ??= line.slice(space + 1);
		}
	}
	if (!properties.proxycommand) {
		throw new Error("ssh -G resolved no ProxyCommand");
	}
	return properties;
}

interface HostBlock {
	host: string;
	properties: Array<[key: Lowercase<string>, value: string]>;
}

/**
 * Compute the effective SSH properties for a host like OpenSSH does: directive
 * names are case-insensitive and the first value wins. Match, Include, and
 * negated or multi-pattern Host lines are not handled.
 */
export function computeSshProperties(
	host: string,
	config: string,
): SshProperties {
	let currentConfig: HostBlock | undefined;
	const configs: HostBlock[] = [];
	config.split("\n").forEach((line) => {
		line = line.trim();
		if (line === "") {
			return;
		}
		// The capture group here will include the captured portion in the array
		// which we need to join them back up with their original values.  The first
		// separate is ignored since it splits the key and value but is not part of
		// the value itself.
		const [key, _, ...valueParts] = line.split(/(\s+|=)/);
		if (key.startsWith("#")) {
			// Ignore comments!
			return;
		}
		const propertyKey = lowercase(key);
		if (propertyKey === "host") {
			if (currentConfig) {
				configs.push(currentConfig);
			}
			currentConfig = {
				host: valueParts.join(""),
				properties: [],
			};
			return;
		}
		if (!currentConfig) {
			return;
		}
		currentConfig.properties.push([propertyKey, valueParts.join("")]);
	});
	if (currentConfig) {
		configs.push(currentConfig);
	}

	const merged: SshProperties = {};
	configs.forEach((config) => {
		if (!matchesHostPattern(host, config.host)) {
			return;
		}
		config.properties.forEach(([key, value]) => {
			if (!Object.hasOwn(merged, key)) {
				merged[key] = value;
			}
		});
	});
	return merged;
}
