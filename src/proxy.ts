// This file is copied from proxy-from-env with added support to use something
// other than environment variables.

import { parse as parseUrl } from "url"

const DEFAULT_PORTS: Record<string, number> = {
  ftp: 21,
  gopher: 70,
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
}

/**
 * @param {string|object} url - The URL, or the result from url.parse.
 * @return {string} The URL of the proxy that should handle the request to the
 *  given URL. If no proxy is set, this will be an empty string.
 */
export function getProxyForUrl(
  url: string,
  httpProxy: string | null | undefined,
  noProxy: string | null | undefined,
): string {
  const parsedUrl = typeof url === "string" ? parseUrl(url) : url || {}
  let proto = parsedUrl.protocol
  let hostname = parsedUrl.host
  const portRaw = parsedUrl.port
  if (typeof hostname !== "string" || !hostname || typeof proto !== "string") {
    return "" // Don't proxy URLs without a valid scheme or host.
  }

  proto = proto.split(":", 1)[0]
  // Stripping ports in this way instead of using parsedUrl.hostname to make
  // sure that the brackets around IPv6 addresses are kept.
  hostname = hostname.replace(/:\d*$/, "")
  const port = (portRaw && parseInt(portRaw)) || DEFAULT_PORTS[proto] || 0
  if (!shouldProxy(hostname, port, noProxy)) {
    return "" // Don't proxy URLs that match NO_PROXY.
  }

  let proxy =
    httpProxy ||
    getEnv("npm_config_" + proto + "_proxy") ||
    getEnv(proto + "_proxy") ||
    getEnv("npm_config_proxy") ||
    getEnv("all_proxy")
  if (proxy && proxy.indexOf("://") === -1) {
    // Missing scheme in proxy, default to the requested URL's scheme.
    proxy = proto + "://" + proxy
  }
  return proxy
}

/**
 * Determines whether a given URL should be proxied.
 *
 * @param {string} hostname - The host name of the URL.
 * @param {number} port - The effective port of the URL.
 * @returns {boolean} Whether the given URL should be proxied.
 * @private
 */
function shouldProxy(hostname: string, port: number, noProxy: string | null | undefined): boolean {
  const NO_PROXY = (noProxy || getEnv("npm_config_no_proxy") || getEnv("no_proxy")).toLowerCase()
  if (!NO_PROXY) {
    return true // Always proxy if NO_PROXY is not set.
  }
  if (NO_PROXY === "*") {
    return false // Never proxy if wildcard is set.
  }

  return NO_PROXY.split(/[,\s]/).every(function (proxy) {
    if (!proxy) {
      return true // Skip zero-length hosts.
    }
    const parsedProxy = proxy.match(/^(.+):(\d+)$/)
    let parsedProxyHostname = parsedProxy ? parsedProxy[1] : proxy
    const parsedProxyPort = parsedProxy ? parseInt(parsedProxy[2]) : 0
    if (parsedProxyPort && parsedProxyPort !== port) {
      return true // Skip if ports don't match.
    }

    if (!/^[.*]/.test(parsedProxyHostname)) {
      // No wildcards, so stop proxying if there is an exact match.
      return hostname !== parsedProxyHostname
    }

    if (parsedProxyHostname.charAt(0) === "*") {
      // Remove leading wildcard.
      parsedProxyHostname = parsedProxyHostname.slice(1)
    }
    // Stop proxying if the hostname ends with the no_proxy host.
    return !hostname.endsWith(parsedProxyHostname)
  })
}

/**
 * Get the value for an environment variable.
 *
 * @param {string} key - The name of the environment variable.
 * @return {string} The value of the environment variable.
 * @private
 */
function getEnv(key: string): string {
  return process.env[key.toLowerCase()] || process.env[key.toUpperCase()] || ""
}
