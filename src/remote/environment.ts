import * as vscode from "vscode";

import { joinNoProxy, pinProxyEnv } from "../api/proxy";
import { LocalProxySettings } from "../settings/proxy";
import { sessionId } from "../telemetry/ids";

import type {
	GlobalEnvironmentVariableCollection,
	WorkspaceConfiguration,
} from "vscode";

import type { WatchedSetting } from "../configWatcher";

import type { SshProperties } from "./sshSupport";

export const SESSION_TYPE_ENV = "CODER_SSH_SESSION_TYPE";
export const CLIENT_ALIVE_INTERVAL_ENV = "CODER_SSH_CLIENT_ALIVE_INTERVAL";
export const CLIENT_ALIVE_COUNT_MAX_ENV = "CODER_SSH_CLIENT_ALIVE_COUNT_MAX";

type Environment = Record<string, string | undefined>;
type SshProxyEnvironment = Partial<
	Record<"HTTP_PROXY" | "HTTPS_PROXY" | "NO_PROXY", string>
>;

/**
 * The settings {@link getSshProxyEnvironment} reads, with a display title and a
 * getter for each current value.
 */
export const SSH_PROXY_SETTINGS: ReadonlyArray<
	WatchedSetting & { title: string }
> = [
	{
		setting: "http.proxy",
		title: "HTTP Proxy",
		getValue: () => LocalProxySettings.get("http.proxy"),
	},
	{
		setting: "http.proxySupport",
		title: "HTTP Proxy Support",
		getValue: () => LocalProxySettings.get("http.proxySupport"),
	},
	{
		setting: "http.noProxy",
		title: "HTTP No Proxy",
		getValue: () => LocalProxySettings.get("http.noProxy"),
	},
	{
		setting: "coder.proxyBypass",
		title: "Proxy Bypass",
		getValue: () =>
			vscode.workspace.getConfiguration().get("coder.proxyBypass"),
	},
];

/**
 * Apply the SSH environment that the spawned `coder ssh` ProxyCommand inherits.
 * Includes the proxy config (HTTP_PROXY/HTTPS_PROXY/NO_PROXY), read by the coder
 * CLI like any Go HTTP client, the session ID via CODER_TRACE_SESSION_ID so
 * the CLI reuses the plugin's session ID instead of generating its own, and
 * CODER_SSH_SESSION_TYPE, which ssh forwards to the agent through `SendEnv`. Applied
 * via both process.env (ssh spawned as a child, `remote.SSH.useLocalServer=true`)
 * and the terminal env collection (ssh spawned in a terminal,
 * `useLocalServer=false`, which can't see process.env), since the mode isn't
 * knowable up front. Mutating env rather than the SSH config keeps credentialed
 * URLs off disk and windows independent. Disposable restores both.
 */
export function applySshEnvironment(
	cfg: Pick<WorkspaceConfiguration, "get">,
	collection: Pick<
		GlobalEnvironmentVariableCollection,
		"persistent" | "replace" | "clear"
	>,
	sessionApp: string,
	env: Environment = process.env,
): { dispose(): void } {
	const values: Environment = {
		...getSshProxyEnvironment(cfg),
		CODER_TRACE_SESSION_ID: sessionId,
		[SESSION_TYPE_ENV]: sessionApp,
	};
	const restoreEnv = applyEnvironment(values, env);

	collection.persistent = false;
	// Drop stale vars from a prior connect (e.g. NO_PROXY set last time, not now).
	collection.clear();
	replaceInCollection(collection, values);

	return {
		dispose() {
			restoreEnv.dispose();
			collection.clear();
		},
	};
}

/**
 * Forward the resolved `ServerAliveInterval` and `ServerAliveCountMax` through
 * `SendEnv`, so the agent drops a dead connection on the same schedule.
 */
export function applyClientAliveEnvironment(
	collection: Pick<GlobalEnvironmentVariableCollection, "replace" | "delete">,
	properties: SshProperties,
	env: Environment = process.env,
): { dispose(): void } {
	const values: Environment = {
		[CLIENT_ALIVE_INTERVAL_ENV]: properties.serveraliveinterval,
		[CLIENT_ALIVE_COUNT_MAX_ENV]: properties.serveralivecountmax,
	};
	const restoreEnv = applyEnvironment(values, env);
	replaceInCollection(collection, values);

	return {
		dispose() {
			restoreEnv.dispose();
			for (const key of Object.keys(values)) {
				collection.delete(key);
			}
		},
	};
}

function replaceInCollection(
	collection: Pick<GlobalEnvironmentVariableCollection, "replace">,
	values: Environment,
): void {
	for (const [key, value] of Object.entries(values)) {
		if (value) {
			collection.replace(key, value);
		}
	}
}

/** The proxy portion of the SSH environment, derived from VS Code's settings. */
export function getSshProxyEnvironment(
	cfg: Pick<WorkspaceConfiguration, "get">,
): SshProxyEnvironment {
	if (LocalProxySettings.get<string>("http.proxySupport") === "off") {
		return {};
	}

	const httpProxy = trimmed(
		LocalProxySettings.get<string | null>("http.proxy"),
	);
	const noProxy =
		trimmed(cfg.get<string | null>("coder.proxyBypass")) ??
		joinNoProxy(LocalProxySettings.get<string[]>("http.noProxy"));

	return {
		HTTP_PROXY: httpProxy,
		HTTPS_PROXY: httpProxy,
		NO_PROXY: noProxy,
	};
}

function applyEnvironment(
	values: Environment,
	env: Environment,
): { dispose(): void } {
	// Stored `undefined` means the key was absent and should be deleted on cleanup.
	const previous: Environment = {};
	const unpins: Array<() => void> = [];
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) {
			continue;
		}
		if (env === process.env) {
			unpins.push(pinProxyEnv(key));
		}
		previous[key] = env[key];
		env[key] = value;
	}

	let disposed = false;
	return {
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			unpins.forEach((unpin) => unpin());
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) {
					delete env[key];
				} else {
					env[key] = value;
				}
			}
		},
	};
}

function trimmed(value: string | null | undefined): string | undefined {
	return typeof value === "string" ? value.trim() || undefined : undefined;
}
