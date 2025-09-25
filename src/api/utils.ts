import fs from "fs";
import { ProxyAgent } from "proxy-agent";
import { type WorkspaceConfiguration } from "vscode";

import { getProxyForUrl } from "../proxy";
import { expandPath } from "../util";

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
export function createHttpAgent(cfg: WorkspaceConfiguration): ProxyAgent {
	const insecure = Boolean(cfg.get("coder.insecure"));
	const certFile = expandPath(
		String(cfg.get("coder.tlsCertFile") ?? "").trim(),
	);
	const keyFile = expandPath(String(cfg.get("coder.tlsKeyFile") ?? "").trim());
	const caFile = expandPath(String(cfg.get("coder.tlsCaFile") ?? "").trim());
	const altHost = expandPath(String(cfg.get("coder.tlsAltHost") ?? "").trim());

	return new ProxyAgent({
		// Called each time a request is made.
		getProxyForUrl: (url: string) => {
			return getProxyForUrl(
				url,
				cfg.get("http.proxy"),
				cfg.get("coder.proxyBypass"),
			);
		},
		cert: certFile === "" ? undefined : fs.readFileSync(certFile),
		key: keyFile === "" ? undefined : fs.readFileSync(keyFile),
		ca: caFile === "" ? undefined : fs.readFileSync(caFile),
		servername: altHost === "" ? undefined : altHost,
		// rejectUnauthorized defaults to true, so we need to explicitly set it to
		// false if we want to allow self-signed certificates.
		rejectUnauthorized: !insecure,
	});
}
