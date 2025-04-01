import { Api } from "coder/site/src/api/api"
import { Workspace, GetInboxNotificationResponse } from "coder/site/src/api/typesGenerated"
import { ProxyAgent } from "proxy-agent"
import * as vscode from "vscode"
import { WebSocket } from "ws"
import { errToStr } from "./api-helper"
import { getMemoryLogger } from "./memoryLogger"
import { type Storage } from "./storage"

// These are the template IDs of our notifications.
// Maybe in the future we should avoid hardcoding
// these in both coderd and here.
const TEMPLATE_WORKSPACE_OUT_OF_MEMORY = "a9d027b4-ac49-4fb1-9f6d-45af15f64e7a"
const TEMPLATE_WORKSPACE_OUT_OF_DISK = "f047f6a3-5713-40f7-85aa-0394cce9fa3a"

export class Inbox implements vscode.Disposable {
  readonly #storage: Storage
  #disposed = false
  #socket: WebSocket
  #messageCount = 0
  #workspaceId: string

  constructor(workspace: Workspace, httpAgent: ProxyAgent, restClient: Api, storage: Storage) {
    const logger = getMemoryLogger()
    this.#storage = storage
    this.#workspaceId = workspace.id

    logger.trackResourceCreated("InboxWebSocket", workspace.id)
    logger.info(`Creating inbox for workspace: ${workspace.owner_name}/${workspace.name} (${workspace.id})`)

    const baseUrlRaw = restClient.getAxiosInstance().defaults.baseURL
    if (!baseUrlRaw) {
      throw new Error("No base URL set on REST client")
    }

    const watchTemplates = [TEMPLATE_WORKSPACE_OUT_OF_DISK, TEMPLATE_WORKSPACE_OUT_OF_MEMORY]
    const watchTemplatesParam = encodeURIComponent(watchTemplates.join(","))

    const watchTargets = [workspace.id]
    const watchTargetsParam = encodeURIComponent(watchTargets.join(","))

    // We shouldn't need to worry about this throwing. Whilst `baseURL` could
    // be an invalid URL, that would've caused issues before we got to here.
    const baseUrl = new URL(baseUrlRaw)
    const socketProto = baseUrl.protocol === "https:" ? "wss:" : "ws:"
    const socketUrl = `${socketProto}//${baseUrl.host}/api/v2/notifications/inbox/watch?format=plaintext&templates=${watchTemplatesParam}&targets=${watchTargetsParam}`

    logger.debug(`Connecting to inbox WebSocket at: ${socketUrl}`)

    const coderSessionTokenHeader = "Coder-Session-Token"
    this.#socket = new WebSocket(new URL(socketUrl), {
      followRedirects: true,
      agent: httpAgent,
      headers: {
        [coderSessionTokenHeader]: restClient.getAxiosInstance().defaults.headers.common[coderSessionTokenHeader] as
          | string
          | undefined,
      },
    })

    this.#socket.on("open", () => {
      logger.info(`Inbox WebSocket connection opened for workspace: ${workspace.id}`)
      this.#storage.writeToCoderOutputChannel("Listening to Coder Inbox")
    })

    this.#socket.on("error", (error) => {
      logger.error(`Inbox WebSocket error for workspace: ${workspace.id}`, error)
      this.notifyError(error)
      this.dispose()
    })

    this.#socket.on("close", (code, reason) => {
      logger.info(`Inbox WebSocket closed for workspace: ${workspace.id}, code: ${code}, reason: ${reason || "none"}`)
      if (!this.#disposed) {
        this.dispose()
      }
    })

    this.#socket.on("message", (data) => {
      this.#messageCount++

      // Log periodic message stats
      if (this.#messageCount % 10 === 0) {
        logger.info(`Inbox received ${this.#messageCount} messages for workspace: ${workspace.id}`)
        logger.logMemoryUsage("INBOX_WEBSOCKET")
      }

      try {
        const inboxMessage = JSON.parse(data.toString()) as GetInboxNotificationResponse
        logger.debug(`Inbox notification received: ${inboxMessage.notification.title}`)
        vscode.window.showInformationMessage(inboxMessage.notification.title)
      } catch (error) {
        logger.error(`Error processing inbox message for workspace: ${workspace.id}`, error)
        this.notifyError(error)
      }
    })

    // Log memory stats periodically
    const memoryInterval = setInterval(
      () => {
        if (!this.#disposed) {
          logger.logMemoryUsage("INBOX_PERIODIC")
        } else {
          clearInterval(memoryInterval)
        }
      },
      5 * 60 * 1000,
    ) // Every 5 minutes
  }

  dispose() {
    const logger = getMemoryLogger()

    if (!this.#disposed) {
      logger.info(`Disposing inbox for workspace: ${this.#workspaceId} after ${this.#messageCount} messages`)
      this.#storage.writeToCoderOutputChannel("No longer listening to Coder Inbox")
      this.#socket.close()
      this.#disposed = true
      logger.trackResourceDisposed("InboxWebSocket", this.#workspaceId)
    }
  }

  private notifyError(error: unknown) {
    const logger = getMemoryLogger()
    const message = errToStr(error, "Got empty error while monitoring Coder Inbox")

    logger.error(`Inbox error for workspace: ${this.#workspaceId}`, error)
    this.#storage.writeToCoderOutputChannel(message)
  }
}
