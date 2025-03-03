import { Api } from "coder/site/src/api/api"
import * as vscode from "vscode"
import { WebSocket } from "ws"
import { errToStr } from "./api-helper"
import { Storage } from "./storage"

type InboxMessage = {
  unread_count: number
  notification: {
    id: string
    user_id: string
    template_id: string
    targets: string[]
    title: string
    content: string
    actions: {
      [key: string]: string
    }
    read_at: string
    created_at: string
  }
}

const TemplateWorkspaceOutOfMemory = "a9d027b4-ac49-4fb1-9f6d-45af15f64e7a"
const TemplateWorkspaceOutOfDisk = "f047f6a3-5713-40f7-85aa-0394cce9fa3a"

export class Inbox implements vscode.Disposable {
  private disposed = false
  private socket: WebSocket

  constructor(
    private readonly restClient: Api,
    private readonly storage: Storage,
  ) {
    // const url = this.restClient.getAxiosInstance().defaults.baseURL
    const token = this.restClient.getAxiosInstance().defaults.headers.common["Coder-Session-Token"] as
      | string
      | undefined
    // const inboxUrl = new URL(`${url}/api/v2/notifications/watch`);
    const inboxUrl = new URL(`ws://localhost:8080`)

    this.storage.writeToCoderOutputChannel("Listening to Coder Inbox")

    // We're gonna connect over WebSocket so replace the scheme.
    if (inboxUrl.protocol === "https") {
      inboxUrl.protocol = "wss"
    } else if (inboxUrl.protocol === "http") {
      inboxUrl.protocol = "ws"
    }

    this.socket = new WebSocket(inboxUrl, {
      headers: {
        "Coder-Session-Token": token,
      },
    })

    this.socket.on("error", (error) => {
      this.notifyError(error)
    })

    this.socket.on("message", (data) => {
      try {
        const inboxMessage = JSON.parse(data.toString()) as InboxMessage

        if (
          inboxMessage.notification.template_id === TemplateWorkspaceOutOfDisk ||
          inboxMessage.notification.template_id === TemplateWorkspaceOutOfMemory
        ) {
          vscode.window.showWarningMessage(inboxMessage.notification.title)
        }
      } catch (error) {
        this.notifyError(error)
      }
    })
  }

  dispose() {
    if (!this.disposed) {
      this.storage.writeToCoderOutputChannel("No longer listening to Coder Inbox")
      this.socket.close()
      this.disposed = true
    }
  }

  private notifyError(error: unknown) {
    const message = errToStr(error, "Got empty error while monitoring Coder Inbox")
    this.storage.writeToCoderOutputChannel(message)
  }
}
