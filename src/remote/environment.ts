import { getProxyForUrl } from "../api/proxy";

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
 * with `remote.SSH.useLocalServer=false` spawns ssh off a path that does not
 * inherit, so propagation there needs `useLocalServer=true`. Returns a disposable
 * that restores the previous values.
 */
export function applySshEnvironment(
	baseUrl: string,
	cfg: Pick<WorkspaceConfiguration, "get">,
	env: Environment = process.env,
): { dispose(): void } {
	return applyEnvironment(getSshProxyEnvironment(baseUrl, cfg), env);
}

/**
 * The proxy portion of the SSH environment. Exposed so callers can check whether
 * a proxy actually applies to a deployment via `.HTTP_PROXY`.
 */
export function getSshProxyEnvironment(
	baseUrl: string,
	cfg: Pick<WorkspaceConfiguration, "get">,
): SshEnvironment {
	const httpProxy = getSetting(cfg, "http.proxy");
	const noProxy = getSetting(cfg, "coder.proxyBypass") ?? getHttpNoProxy(cfg);
	const proxy = httpProxy
		? getProxyForUrl(baseUrl, httpProxy, noProxy, undefined)
		: "";

	return {
		...(proxy ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy } : {}),
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
		for (const envKey of getEnvKeys(env, key)) {
			previous.push([envKey, Object.hasOwn(env, envKey), env[envKey]]);
			env[envKey] = value;
		}
	}

	let disposed = false;
	return {
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			for (let i = previous.length - 1; i >= 0; i--) {
				const [key, existed, value] = previous[i];
				if (existed) {
					env[key] = value;
				} else {
					delete env[key];
				}
			}
		},
	};
}

function getEnvKeys(env: Environment, key: string): string[] {
	const keys = Object.keys(env).filter(
		(envKey) => envKey.toLowerCase() === key.toLowerCase(),
	);
	return keys.length > 0 ? keys : [key];
}

function getSetting(
	cfg: Pick<WorkspaceConfiguration, "get">,
	setting: string,
): string | undefined {
	const value = cfg.get<string | null>(setting);
	return typeof value === "string" ? value.trim() || undefined : undefined;
}

function getHttpNoProxy(
	cfg: Pick<WorkspaceConfiguration, "get">,
): string | undefined {
	return (
		cfg
			.get<string[]>("http.noProxy", [])
			.map((value) => value.trim())
			.filter(Boolean)
			.join(",") || undefined
	);
}
