import fs from "node:fs/promises";
import { ProxyAgent } from "proxy-agent";
import { type WorkspaceConfiguration } from "vscode";

import { expandPath } from "../util";

import { getProxyForUrl, joinNoProxy } from "./proxy";

/**
 * Return whether the API will need a token for authorization.
 * If mTLS is in use (as specified by the cert or key files being set) then
 * token authorization is disabled. Otherwise, it is enabled.
 */
export function needToken(cfg: Pick<WorkspaceConfiguration, "get">): boolean {
	const certFile = expandPath(
		String(cfg.get("coder.tlsCertFile") ?? "").trim(),
	);
	const keyFile = expandPath(String(cfg.get("coder.tlsKeyFile") ?? "").trim());
	return !certFile && !keyFile;
}

/**
 * Create a new HTTP agent based on the current VS Code settings.
 * Configures proxy, TLS certificates, and security options.
 */
export async function createHttpAgent(
	cfg: Pick<WorkspaceConfiguration, "get">,
): Promise<ProxyAgent> {
	const insecure = cfg.get<boolean>("coder.insecure", false);
	const proxyStrictSSL = cfg.get<boolean>("http.proxyStrictSSL", true);
	const proxySupport = cfg.get<string>("http.proxySupport");
	const proxyEnabled = proxySupport !== "off";
	const proxyAuthorization = proxyEnabled
		? cfg.get<string | null>("http.proxyAuthorization")
		: undefined;
	const httpProxy = proxyEnabled
		? cfg.get<string | null>("http.proxy")
		: undefined;
	const coderProxyBypass = proxyEnabled
		? cfg.get<string | null>("coder.proxyBypass")
		: undefined;
	const httpNoProxy = proxyEnabled
		? cfg.get<string[]>("http.noProxy")
		: undefined;

	const certFile = expandPath(
		String(cfg.get("coder.tlsCertFile") ?? "").trim(),
	);
	const keyFile = expandPath(String(cfg.get("coder.tlsKeyFile") ?? "").trim());
	const caFile = expandPath(String(cfg.get("coder.tlsCaFile") ?? "").trim());
	const altHost = expandPath(String(cfg.get("coder.tlsAltHost") ?? "").trim());

	const [cert, key, ca] = await Promise.all([
		certFile === "" ? Promise.resolve(undefined) : fs.readFile(certFile),
		keyFile === "" ? Promise.resolve(undefined) : fs.readFile(keyFile),
		caFile === "" ? Promise.resolve(undefined) : fs.readFile(caFile),
	]);

	// Build proxy authorization header if configured.
	const headers: Record<string, string> | undefined = proxyAuthorization
		? { "Proxy-Authorization": proxyAuthorization }
		: undefined;

	return new ProxyAgent({
		// Called each time a request is made.
		getProxyForUrl: (url: string) => {
			return getProxyForUrl(
				url,
				httpProxy,
				coderProxyBypass,
				joinNoProxy(httpNoProxy),
			);
		},
		headers,
		cert,
		key,
		ca,
		servername: altHost === "" ? undefined : altHost,
		// TLS verification is disabled if either:
		// - http.proxyStrictSSL is false (VS Code's proxy SSL setting)
		// - coder.insecure is true (backward compatible override for Coder server)
		rejectUnauthorized: proxyStrictSSL && !insecure,
	});
}
