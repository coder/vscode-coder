import { Api } from "coder/site/src/api/api"
import fs from "fs/promises"
import * as os from "os"
import { ProxyAgent } from "proxy-agent"
import { getProxyForUrl } from "proxy-from-env"
import * as vscode from "vscode"
import { CertificateError } from "./error"
import { Storage } from "./storage"

// expandPath will expand ${userHome} in the input string.
const expandPath = (input: string): string => {
  const userHome = os.homedir()
  return input.replace(/\${userHome}/g, userHome)
}

/**
 * Create an sdk instance using the provided URL and token and hook it up to
 * configuration.  The token may be undefined if some other form of
 * authentication is being used.
 */
export async function makeCoderSdk(baseUrl: string, token: string | undefined, storage: Storage): Promise<Api> {
  const restClient = new Api()
  restClient.setHost(baseUrl)
  if (token) {
    restClient.setSessionToken(token)
  }

  restClient.getAxiosInstance().interceptors.request.use(async (config) => {
    // Add headers from the header command.
    Object.entries(await storage.getHeaders(baseUrl)).forEach(([key, value]) => {
      config.headers[key] = value
    })

    const cfg = vscode.workspace.getConfiguration()
    const insecure = Boolean(cfg.get("coder.insecure"))
    const certFile = expandPath(String(cfg.get("coder.tlsCertFile") ?? "").trim())
    const keyFile = expandPath(String(cfg.get("coder.tlsKeyFile") ?? "").trim())
    const caFile = expandPath(String(cfg.get("coder.tlsCaFile") ?? "").trim())

    // Configure proxy and TLS.
    const agent = new ProxyAgent({
      // If the proxy setting exists, we always use it.  Otherwise we follow the
      // standard environment variables (no_proxy, http_proxy, etc).
      getProxyForUrl: (url: string) => cfg.get("http.proxy") || getProxyForUrl(url),
      cert: certFile === "" ? undefined : await fs.readFile(certFile),
      key: keyFile === "" ? undefined : await fs.readFile(keyFile),
      ca: caFile === "" ? undefined : await fs.readFile(caFile),
      // rejectUnauthorized defaults to true, so we need to explicitly set it to
      // false if we want to allow self-signed certificates.
      rejectUnauthorized: !insecure,
    })

    config.httpsAgent = agent
    config.httpAgent = agent

    return config
  })

  // Wrap certificate errors.
  restClient.getAxiosInstance().interceptors.response.use(
    (r) => r,
    async (err) => {
      throw await CertificateError.maybeWrap(err, baseUrl, storage)
    },
  )

  return restClient
}
