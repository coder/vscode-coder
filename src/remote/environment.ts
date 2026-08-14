import { joinNoProxy } from "../api/proxy";
import { sessionId } from "../core/sessionId";

import type {
	GlobalEnvironmentVariableCollection,
	WorkspaceConfiguration,
} from "vscode";

type Environment = Record<string, string | undefined>;
type SshProxyEnvironment = Partial<
	Record<"HTTP_PROXY" | "HTTPS_PROXY" | "NO_PROXY", string>
>;

/**
 * The settings {@link getSshProxyEnvironment} reads, paired with display titles.
 * Watch these to prompt for a reload when the SSH proxy environment changes.
 */
export const SSH_PROXY_SETTINGS: ReadonlyArray<{
	setting: string;
	title: string;
}> = [
	{ setting: "http.proxy", title: "HTTP Proxy" },
	{ setting: "http.proxySupport", title: "HTTP Proxy Support" },
	{ setting: "http.noProxy", title: "HTTP No Proxy" },
	{ setting: "coder.proxyBypass", title: "Proxy Bypass" },
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
	if (cfg.get<string>("http.proxySupport") === "off") {
		return {};
	}

	const httpProxy = trimmed(cfg.get<string | null>("http.proxy"));
	const noProxy =
		trimmed(cfg.get<string | null>("coder.proxyBypass")) ??
		joinNoProxy(cfg.get<string[]>("http.noProxy"));

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
