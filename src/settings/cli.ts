import os from "node:os";

import { escapeCommandArg, escapeShellArg, expandPath } from "../util";

import { getHeaderArgs } from "./headers";

import type { WorkspaceConfiguration } from "vscode";

import type { FeatureSet } from "../featureSet";

/** The CLI's own store (its config directory or the keyring, shared with the terminal), or a directory private to the extension. */
export type CliAuth = {
	url: string;
	/** The extension follows redirects itself; from 2.38 the CLI needs the flag to match. */
	allowRedirects: boolean;
} & (
	| { store: "cli"; useKeyring: boolean | undefined }
	| { store: "extension"; configDir: string; useKeyring: false | undefined }
);

/**
 * Returns the user's `coder.globalFlags` with `expandPath` applied. For
 * `--flag=value` entries the substitution is scoped to the value half so
 * `--cfg=~/coder` works without rewriting the flag name.
 */
export function getExpandedUserGlobalFlags(
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
	// Escape after stripping so expansion whitespace stays in one shell token.
	const flags = stripManagedFlags(
		getExpandedUserGlobalFlags(configs),
		auth.store === "extension",
	).map(escAuth);
	if (auth.store === "extension") {
		flags.push("--global-config", escAuth(auth.configDir));
	}
	flags.push("--url", escAuth(auth.url));
	if (auth.useKeyring !== undefined) {
		flags.push(`--use-keyring=${auth.useKeyring}`);
	}
	if (auth.allowRedirects) {
		flags.push("--allow-redirects");
	}
	return [...flags, ...getHeaderArgs(configs, escHeader)];
}

/** Drops `--use-keyring`, and `--global-config` when the extension supplies its own. */
function stripManagedFlags(
	flags: string[],
	stripGlobalConfig: boolean,
): string[] {
	const filtered: string[] = [];
	for (let i = 0; i < flags.length; i++) {
		if (isFlag(flags[i], "--use-keyring")) {
			continue;
		}
		if (stripGlobalConfig && isFlag(flags[i], "--global-config")) {
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

/** True on platforms with an OS keyring the CLI supports (macOS, Windows). */
export function isKeyringSupported(): boolean {
	const platform = os.platform();
	return platform === "darwin" || platform === "win32";
}

/** True when `coder.useKeyring` is on and the platform supports it. */
export function isKeyringEnabled(
	configs: Pick<WorkspaceConfiguration, "get">,
): boolean {
	return isKeyringSupported() && configs.get<boolean>("coder.useKeyring", true);
}

/** True when settings allow the CLI's own store: the keyring is on or a user config directory is set. `resolveCliAuth` adds the CLI version gates. */
export function mayUseCliStore(
	configs: Pick<WorkspaceConfiguration, "get">,
): boolean {
	return isKeyringEnabled(configs) || hasUserConfigDir(configs);
}

/** Uses the CLI's own store when the keyring is on or the user set a config directory. */
export function resolveCliAuth(
	configs: Pick<WorkspaceConfiguration, "get">,
	featureSet: FeatureSet,
	url: string,
	configDir: string,
): CliAuth {
	// Below 2.29 the CLI lacks --use-keyring.
	const useKeyring = featureSet.keyringAuth
		? isKeyringEnabled(configs)
		: undefined;
	// A user directory is honored on 2.32+, where the CLI reports its token.
	const userDir = hasUserConfigDir(configs) && featureSet.tokenRead;
	const common = { url, allowRedirects: featureSet.allowRedirects };
	if (useKeyring || userDir) {
		return { ...common, store: "cli", useKeyring };
	}
	return { ...common, store: "extension", configDir, useKeyring };
}

function hasUserConfigDir(
	configs: Pick<WorkspaceConfiguration, "get">,
): boolean {
	return (
		Boolean(process.env.CODER_CONFIG_DIR) ||
		getExpandedUserGlobalFlags(configs).some((flag) =>
			isFlag(flag, "--global-config"),
		)
	);
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
