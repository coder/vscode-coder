// Based on proxy-from-env 2.1.0. Proxy and no-proxy lists can come from
// settings, and the env fallback reads pinned values first.

const DEFAULT_PORTS: Record<string, number> = {
	ftp: 21,
	gopher: 70,
	http: 80,
	https: 443,
	ws: 80,
	wss: 443,
};

const pinnedEnv = new Map<string, string>();

/**
 * Keep the env fallback on `key`'s current value after this process overwrites
 * it for child processes. Returns a function that unpins it, or a no-op when
 * `key` is already pinned, so the first pin's value and owner win.
 */
export function pinProxyEnv(key: string): () => void {
	const upper = key.toUpperCase();
	if (pinnedEnv.has(upper)) {
		return () => undefined;
	}
	pinnedEnv.set(upper, getEnv(key));
	return () => pinnedEnv.delete(upper);
}

/** Join a no-proxy list into a comma string, dropping blanks. */
export function joinNoProxy(
	entries: string[] | null | undefined,
): string | undefined {
	return (
		entries
			?.map((entry) => entry.trim())
			.filter(Boolean)
			.join(",") || undefined
	);
}

/**
 * @param {string} url - The URL to request.
 * @param {string} httpProxy - The proxy URL to use.
 * @param {string} noProxy - Primary no-proxy list (e.g., coder.proxyBypass).
 * @param {string} noProxyFallback - Fallback no-proxy list (e.g., http.noProxy).
 * @return {string} The URL of the proxy that should handle the request to the
 *  given URL. If no proxy is set, this will be an empty string.
 */
export function getProxyForUrl(
	url: string,
	httpProxy: string | null | undefined,
	noProxy: string | null | undefined,
	noProxyFallback?: string | null,
): string {
	const parsedUrl = URL.parse(url);
	if (!parsedUrl?.hostname) {
		return ""; // Don't proxy URLs without a valid scheme or host.
	}

	const proto = parsedUrl.protocol.slice(0, -1);
	const hostname = parsedUrl.hostname;
	const port = Number.parseInt(parsedUrl.port) || DEFAULT_PORTS[proto] || 0;
	if (!shouldProxy(hostname, port, noProxy, noProxyFallback)) {
		return ""; // Don't proxy URLs that match NO_PROXY.
	}

	let proxy = httpProxy || getEnv(proto + "_proxy") || getEnv("all_proxy");
	if (proxy && !proxy.includes("://")) {
		// Missing scheme in proxy, default to the requested URL's scheme.
		proxy = proto + "://" + proxy;
	}
	return proxy;
}

/**
 * Determines whether a given URL should be proxied.
 *
 * @param {string} hostname - The host name of the URL.
 * @param {number} port - The effective port of the URL.
 * @param {string} noProxy - Primary no-proxy list (e.g., coder.proxyBypass).
 * @param {string} noProxyFallback - Fallback no-proxy list (e.g., http.noProxy).
 * @returns {boolean} Whether the given URL should be proxied.
 * @private
 */
function shouldProxy(
	hostname: string,
	port: number,
	noProxy: string | null | undefined,
	noProxyFallback?: string | null,
): boolean {
	const NO_PROXY = (
		noProxy ||
		noProxyFallback ||
		getEnv("no_proxy")
	).toLowerCase();
	if (!NO_PROXY) {
		return true; // Always proxy if NO_PROXY is not set.
	}
	if (NO_PROXY === "*") {
		return false; // Never proxy if wildcard is set.
	}

	return NO_PROXY.split(/[,\s]/).every(function (proxy) {
		if (!proxy) {
			return true; // Skip zero-length hosts.
		}
		const parsedProxy = /^(.+):(\d+)$/.exec(proxy);
		let parsedProxyHostname = parsedProxy ? parsedProxy[1] : proxy;
		const parsedProxyPort = parsedProxy ? Number.parseInt(parsedProxy[2]) : 0;
		if (parsedProxyPort && parsedProxyPort !== port) {
			return true; // Skip if ports don't match.
		}

		if (!/^[.*]/.test(parsedProxyHostname)) {
			// No wildcards, so stop proxying if there is an exact match.
			return hostname !== parsedProxyHostname;
		}

		if (parsedProxyHostname.startsWith("*")) {
			// Remove leading wildcard.
			parsedProxyHostname = parsedProxyHostname.slice(1);
		}
		// Stop proxying if the hostname ends with the no_proxy host.
		return !hostname.endsWith(parsedProxyHostname);
	});
}

/**
 * Get the value for an environment variable.
 *
 * @param {string} key - The name of the environment variable.
 * @return {string} The value of the environment variable.
 * @private
 */
function getEnv(key: string): string {
	return (
		pinnedEnv.get(key.toUpperCase()) ??
		(process.env[key.toLowerCase()] || process.env[key.toUpperCase()] || "")
	);
}
