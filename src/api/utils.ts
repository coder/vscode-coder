import fs from "fs/promises";
import { ProxyAgent } from "proxy-agent";
import { type WorkspaceConfiguration } from "vscode";

import { expandPath } from "../util";

import { getProxyForUrl } from "./proxy";

/**
 * Return whether the API will need a token for authorization.
 * If mTLS is in use (as specified by the cert or key files being set) then
 * token authorization is disabled. Otherwise, it is enabled.
 */
export function needToken(cfg: WorkspaceConfiguration): boolean {
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
	cfg: WorkspaceConfiguration,
): Promise<ProxyAgent> {
	const insecure = Boolean(cfg.get("coder.insecure"));
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

	return new ProxyAgent({
		// Called each time a request is made.
		getProxyForUrl: (url: string) => {
			return getProxyForUrl(
				url,
				cfg.get("http.proxy"),
				cfg.get("coder.proxyBypass"),
			);
		},
		cert,
		key,
		ca,
		servername: altHost === "" ? undefined : altHost,
		// rejectUnauthorized defaults to true, so we need to explicitly set it to
		// false if we want to allow self-signed certificates.
		rejectUnauthorized: !insecure,
	});
}
