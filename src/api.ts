import { Api } from "coder/site/src/api/api"
import fs from "fs/promises"
import * as os from "os"
import { ProxyAgent } from "proxy-agent"
import * as vscode from "vscode"
import { CertificateError } from "./error"
import { getProxyForUrl } from "./proxy"
import { Storage } from "./storage"

// expandPath will expand ${userHome} in the input string.
function expandPath(input: string): string {
  const userHome = os.homedir()
  return input.replace(/\${userHome}/g, userHome)
}

async function createHttpAgent(): Promise<ProxyAgent> {
  const cfg = vscode.workspace.getConfiguration()
  const insecure = Boolean(cfg.get("coder.insecure"))
  const certFile = expandPath(String(cfg.get("coder.tlsCertFile") ?? "").trim())
  const keyFile = expandPath(String(cfg.get("coder.tlsKeyFile") ?? "").trim())
  const caFile = expandPath(String(cfg.get("coder.tlsCaFile") ?? "").trim())

  return new ProxyAgent({
    // Called each time a request is made.
    getProxyForUrl: (url: string) => {
      const cfg = vscode.workspace.getConfiguration()
      return getProxyForUrl(url, cfg.get("http.proxy"), cfg.get("coder.proxyBypass"))
    },
    cert: certFile === "" ? undefined : await fs.readFile(certFile),
    key: keyFile === "" ? undefined : await fs.readFile(keyFile),
    ca: caFile === "" ? undefined : await fs.readFile(caFile),
    // rejectUnauthorized defaults to true, so we need to explicitly set it to
    // false if we want to allow self-signed certificates.
    rejectUnauthorized: !insecure,
  })
}

let agent: Promise<ProxyAgent> | undefined = undefined
async function getHttpAgent(): Promise<ProxyAgent> {
  if (!agent) {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        // http.proxy and coder.proxyBypass are read each time a request is
        // made, so no need to watch them.
        e.affectsConfiguration("coder.insecure") ||
        e.affectsConfiguration("coder.tlsCertFile") ||
        e.affectsConfiguration("coder.tlsKeyFile") ||
        e.affectsConfiguration("coder.tlsCaFile")
      ) {
        agent = createHttpAgent()
      }
    })
    agent = createHttpAgent()
  }
  return agent
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

    // Configure proxy and TLS.
    // Note that by default VS Code overrides the agent.  To prevent this, set
    // `http.proxySupport` to `on` or `off`.
    const agent = await getHttpAgent()
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
