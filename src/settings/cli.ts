import { isKeyringSupported } from "../core/cliCredentialManager";
import { escapeCommandArg, escapeShellArg, expandPath } from "../util";

import { getHeaderArgs } from "./headers";

import type { WorkspaceConfiguration } from "vscode";

import type { FeatureSet } from "../featureSet";

export type CliAuth =
	| { mode: "global-config"; configDir: string }
	| { mode: "url"; url: string };

/**
 * Returns the user's `coder.globalFlags` with `expandPath` applied. For
 * `--flag=value` entries the substitution is scoped to the value half so
 * `--cfg=~/coder` works without rewriting the flag name.
 */
export function getUserGlobalFlags(
	configs: Pick<WorkspaceConfiguration, "get">,
): string[] {
	return configs.get<string[]>("coder.globalFlags", []).map((flag) => {
		const eq = flag.indexOf("=");
		return eq === -1
			? expandPath(flag)
			: flag.slice(0, eq + 1) + expandPath(flag.slice(eq + 1));
	});
}

/** Flags for shell contexts (`terminal.sendText`, SSH `ProxyCommand`). */
export function getGlobalShellFlags(
	configs: Pick<WorkspaceConfiguration, "get">,
	auth: CliAuth,
): string[] {
	return buildGlobalFlags(configs, auth, escapeCommandArg, escapeShellArg);
}

/** Raw flags for `execFile` or `spawn` without a shell. */
export function getGlobalFlags(
	configs: Pick<WorkspaceConfiguration, "get">,
	auth: CliAuth,
): string[] {
	return buildGlobalFlags(configs, auth, identity, identity);
}

const identity = (s: string) => s;

function buildGlobalFlags(
	configs: Pick<WorkspaceConfiguration, "get">,
	auth: CliAuth,
	escAuth: (s: string) => string,
	escHeader: (s: string) => string,
): string[] {
	const authFlags =
		auth.mode === "url"
			? ["--url", escAuth(auth.url)]
			: ["--global-config", escAuth(auth.configDir)];

	const filtered = stripManagedFlags(getUserGlobalFlags(configs));

	return [...filtered, ...authFlags, ...getHeaderArgs(configs, escHeader)];
}

function stripManagedFlags(flags: string[]): string[] {
	const filtered: string[] = [];
	for (let i = 0; i < flags.length; i++) {
		if (isFlag(flags[i], "--use-keyring")) {
			continue;
		}
		if (isFlag(flags[i], "--global-config")) {
			// Skip the next item too when the value is a separate entry.
			if (flags[i] === "--global-config") {
				i++;
			}
			continue;
		}
		filtered.push(flags[i]);
	}
	return filtered;
}

function isFlag(item: string, name: string): boolean {
	return (
		item === name || item.startsWith(`${name}=`) || item.startsWith(`${name} `)
	);
}

/**
 * Returns true when the user has keyring enabled and the platform supports it.
 */
export function isKeyringEnabled(
	configs: Pick<WorkspaceConfiguration, "get">,
): boolean {
	return (
		isKeyringSupported() && configs.get<boolean>("coder.useKeyring", false)
	);
}

/**
 * Resolves how the CLI should authenticate: via the keyring (`--url`) or via
 * the global config directory (`--global-config`).
 */
export function resolveCliAuth(
	configs: Pick<WorkspaceConfiguration, "get">,
	featureSet: FeatureSet,
	deploymentUrl: string,
	configDir: string,
): CliAuth {
	if (isKeyringEnabled(configs) && featureSet.keyringAuth) {
		return { mode: "url", url: deploymentUrl };
	}
	return { mode: "global-config", configDir };
}

/**
 * Returns SSH flags for the `coder ssh` command from user configuration.
 */
export function getSshFlags(
	configs: Pick<WorkspaceConfiguration, "get">,
): string[] {
	// Make sure to match this default with the one in the package.json
	return configs.get<string[]>("coder.sshFlags", ["--disable-autostart"]);
}
