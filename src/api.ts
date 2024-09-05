import { Api } from "coder/site/src/api/api"
import { ProvisionerJobLog, Workspace, WorkspaceStatus } from "coder/site/src/api/typesGenerated"
import fs from "fs/promises"
import { ProxyAgent } from "proxy-agent"
import * as vscode from "vscode"
import * as ws from "ws"
import { errToStr } from "./api-helper"
import { CertificateError } from "./error"
import { getProxyForUrl } from "./proxy"
import { Storage } from "./storage"
import { expandPath } from "./util"

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

/**
 * Start or update a workspace and return the updated workspace.
 */
export async function startWorkspace(restClient: Api, workspace: Workspace): Promise<Workspace> {
  // If the workspace requires the latest active template version, we should attempt
  // to update that here.
  // TODO: If param set changes, what do we do??
  const versionID = workspace.template_require_active_version
    ? // Use the latest template version
      workspace.template_active_version_id
    : // Default to not updating the workspace if not required.
      workspace.latest_build.template_version_id

  const latestBuild = await restClient.startWorkspace(workspace.id, versionID)
  // Before we start a workspace, we make an initial request to check it's not already started
  // let latestBuild = (await restClient.getWorkspace(workspace.id)).latest_build
  // if (!["starting", "running"].includes(latestBuild.status)) {

  // }

  return {
    ...workspace,
    latest_build: latestBuild,
  }
}

/**
 * Get the status of a workspace
 * @param restClient Api
 * @param workspaceId string
 * @returns WorkspaceStatus
 */
export async function getWorkspaceStatus(restClient: Api, workspaceId: string): Promise<WorkspaceStatus> {
  return (await restClient.getWorkspace(workspaceId)).latest_build.status
}

/**
 * Wait for the latest build to finish while streaming logs to the emitter.
 *
 * Once completed, fetch the workspace again and return it.
 */
export async function waitForBuild(
  restClient: Api,
  writeEmitter: vscode.EventEmitter<string>,
  workspace: Workspace,
): Promise<Workspace> {
  const baseUrlRaw = restClient.getAxiosInstance().defaults.baseURL
  if (!baseUrlRaw) {
    throw new Error("No base URL set on REST client")
  }

  // This fetches the initial bunch of logs.
  const logs = await restClient.getWorkspaceBuildLogs(workspace.latest_build.id, new Date())
  logs.forEach((log) => writeEmitter.fire(log.output + "\r\n"))

  // This follows the logs for new activity!
  // TODO: watchBuildLogsByBuildId exists, but it uses `location`.
  //       Would be nice if we could use it here.
  let path = `/api/v2/workspacebuilds/${workspace.latest_build.id}/logs?follow=true`
  if (logs.length) {
    path += `&after=${logs[logs.length - 1].id}`
  }

  await new Promise<void>((resolve, reject) => {
    try {
      const baseUrl = new URL(baseUrlRaw)
      const proto = baseUrl.protocol === "https:" ? "wss:" : "ws:"
      const socketUrlRaw = `${proto}//${baseUrl.host}${path}`
      const socket = new ws.WebSocket(new URL(socketUrlRaw), {
        headers: {
          "Coder-Session-Token": restClient.getAxiosInstance().defaults.headers.common["Coder-Session-Token"] as
            | string
            | undefined,
        },
        followRedirects: true,
      })
      socket.binaryType = "nodebuffer"
      socket.on("message", (data) => {
        const buf = data as Buffer
        const log = JSON.parse(buf.toString()) as ProvisionerJobLog
        writeEmitter.fire(log.output + "\r\n")
      })
      socket.on("error", (error) => {
        reject(
          new Error(`Failed to watch workspace build using ${socketUrlRaw}: ${errToStr(error, "no further details")}`),
        )
      })
      socket.on("close", () => {
        resolve()
      })
    } catch (error) {
      // If this errors, it is probably a malformed URL.
      reject(new Error(`Failed to watch workspace build on ${baseUrlRaw}: ${errToStr(error, "no further details")}`))
    }
  })

  writeEmitter.fire("Build complete\r\n")
  const updatedWorkspace = await restClient.getWorkspace(workspace.id)
  writeEmitter.fire(`Workspace is now ${updatedWorkspace.latest_build.status}\r\n`)
  return updatedWorkspace
}
