import { joinNoProxy } from "../api/proxy";

import type { WorkspaceConfiguration } from "vscode";

type Environment = Record<string, string | undefined>;
type PreviousValue = [key: string, existed: boolean, value: string | undefined];
type SshEnvironment = Partial<
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
	{ setting: "http.noProxy", title: "HTTP No Proxy" },
	{ setting: "coder.proxyBypass", title: "Proxy Bypass" },
];

/**
 * Sets SSH-related environment variables on this extension host's process.env so
 * the spawned `coder ssh` ProxyCommand inherits them. For now that is just the
 * proxy configuration (HTTP_PROXY/HTTPS_PROXY/NO_PROXY): the coder CLI reads them
 * like any Go HTTP client and has no proxy flag. We mutate process.env rather
 * than baking values into the SSH config so no credentialed proxy URL is written
 * to disk and multiple windows onto the same workspace stay independent.
 *
 * Best-effort: only processes spawned afterwards inherit the change. MS VS Code
 * with `remote.SSH.useLocalServer=false` spawns ssh through a code path that
 * does not inherit, so propagation there needs `useLocalServer=true`. Returns a
 * disposable that restores the previous values.
 */
export function applySshEnvironment(
	cfg: Pick<WorkspaceConfiguration, "get">,
	env: Environment = process.env,
): { dispose(): void } {
	return applyEnvironment(getSshProxyEnvironment(cfg), env);
}

/**
 * The proxy portion of the SSH environment. Exposed so callers can check whether
 * proxy settings are configured via `.HTTP_PROXY`.
 */
export function getSshProxyEnvironment(
	cfg: Pick<WorkspaceConfiguration, "get">,
): SshEnvironment {
	const httpProxy = trimmed(cfg.get<string | null>("http.proxy"));
	const noProxy =
		trimmed(cfg.get<string | null>("coder.proxyBypass")) ??
		joinNoProxy(cfg.get<string[]>("http.noProxy"));

	return {
		...(httpProxy ? { HTTP_PROXY: httpProxy, HTTPS_PROXY: httpProxy } : {}),
		...(noProxy ? { NO_PROXY: noProxy } : {}),
	};
}

function applyEnvironment(
	values: SshEnvironment,
	env: Environment,
): { dispose(): void } {
	const previous: PreviousValue[] = [];
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) {
			continue;
		}
		const previousValue = env[key];
		previous.push([key, previousValue !== undefined, previousValue]);
		env[key] = value;
	}

	let disposed = false;
	return {
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			for (const [key, existed, value] of previous) {
				if (existed) {
					env[key] = value;
				} else {
					delete env[key];
				}
			}
		},
	};
}

function trimmed(value: string | null | undefined): string | undefined {
	return typeof value === "string" ? value.trim() || undefined : undefined;
}
