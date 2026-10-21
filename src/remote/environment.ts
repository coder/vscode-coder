import * as vscode from "vscode";

import { joinNoProxy } from "../api/proxy";
import { LocalProxySettings } from "../settings/proxy";
import { sessionId } from "../telemetry/ids";

import type {
	GlobalEnvironmentVariableCollection,
	WorkspaceConfiguration,
} from "vscode";

import type { WatchedSetting } from "../configWatcher";

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
 * CLI like any Go HTTP client, and the session ID via CODER_TRACE_SESSION_ID so
 * the CLI reuses the plugin's session ID instead of generating its own. Applied
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
	env: Environment = process.env,
): { dispose(): void } {
	const values: Environment = {
		...getSshProxyEnvironment(cfg),
		CODER_TRACE_SESSION_ID: sessionId,
	};
	const restoreEnv = applyEnvironment(values, env);

	collection.persistent = false;
	// Drop stale vars from a prior connect (e.g. NO_PROXY set last time, not now).
	collection.clear();
	for (const [key, value] of Object.entries(values)) {
		if (value) {
			collection.replace(key, value);
		}
	}

	return {
		dispose() {
			restoreEnv.dispose();
			collection.clear();
		},
	};
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
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) {
			continue;
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
