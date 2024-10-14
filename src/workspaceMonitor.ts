import { Api } from "coder/site/src/api/api"
import { Workspace } from "coder/site/src/api/typesGenerated"
import { formatDistanceToNowStrict } from "date-fns"
import EventSource from "eventsource"
import * as vscode from "vscode"
import { errToStr } from "./api-helper"
import { Storage } from "./storage"

/**
 * Monitor a single workspace using SSE for events like shutdown and deletion.
 * Notify the user about relevant changes and update contexts as needed.  The
 * workspace status is also shown in the status bar menu.
 */
export class WorkspaceMonitor implements vscode.Disposable {
  private eventSource: EventSource
  private disposed = false

  // How soon in advance to notify about autostop and deletion.
  private autostopNotifyTime = 1000 * 60 * 30 // 30 minutes.
  private deletionNotifyTime = 1000 * 60 * 60 * 24 // 24 hours.

  // Only notify once.
  private notifiedAutostop = false
  private notifiedDeletion = false
  private notifiedOutdated = false

  readonly onChange = new vscode.EventEmitter<Workspace>()
  private readonly updateStatusBarItem: vscode.StatusBarItem

  constructor(
    workspace: Workspace,
    private readonly restClient: Api,
    private readonly storage: Storage,
  ) {
    const url = this.restClient.getAxiosInstance().defaults.baseURL
    const token = this.restClient.getAxiosInstance().defaults.headers.common["Coder-Session-Token"] as
      | string
      | undefined
    const watchUrl = new URL(`${url}/api/v2/workspaces/${workspace.id}/watch`)
    this.storage.writeToCoderOutputChannel(`Monitoring ${watchUrl}`)

    const eventSource = new EventSource(watchUrl.toString(), {
      headers: {
        "Coder-Session-Token": token,
      },
    })

    eventSource.addEventListener("data", (event) => {
      try {
        const newWorkspaceData = JSON.parse(event.data) as Workspace
        this.update(newWorkspaceData)
        this.maybeNotify(newWorkspaceData)
        this.onChange.fire(newWorkspaceData)
      } catch (error) {
        this.notifyError(error)
      }
    })

    eventSource.addEventListener("error", (error) => {
      this.notifyError(error)
    })

    // Store so we can close in dispose().
    this.eventSource = eventSource

    this.updateStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999)
    this.updateStatusBarItem.name = "Coder Workspace Update"
    this.updateStatusBarItem.text = "$(fold-up) Update Workspace"
    this.updateStatusBarItem.command = "coder.workspace.update"

    this.update(workspace) // Set initial state.
    this.maybeNotify(workspace)
  }

  /**
   * Permanently close the SSE stream.
   */
  dispose() {
    if (!this.disposed) {
      this.updateStatusBarItem.dispose()
      this.eventSource.close()
      this.disposed = true
    }
  }

  private update(workspace: Workspace) {
    this.updateContext(workspace)
    this.updateStatusBar(workspace)
  }

  private maybeNotify(workspace: Workspace) {
    this.maybeNotifyOutdated(workspace)
    this.maybeNotifyAutostop(workspace)
    this.maybeNotifyDeletion(workspace)
    this.maybeNotifyNotRunning(workspace)
  }

  private maybeNotifyAutostop(workspace: Workspace) {
    if (
      workspace.latest_build.status === "running" &&
      workspace.latest_build.deadline &&
      !this.notifiedAutostop &&
      this.isImpending(workspace.latest_build.deadline, this.autostopNotifyTime)
    ) {
      const toAutostopTime = formatDistanceToNowStrict(new Date(workspace.latest_build.deadline))
      vscode.window.showInformationMessage(`${workspace.name} is scheduled to shut down in ${toAutostopTime}.`)
      this.notifiedAutostop = true
    }
  }

  private maybeNotifyDeletion(workspace: Workspace) {
    if (
      workspace.deleting_at &&
      !this.notifiedDeletion &&
      this.isImpending(workspace.deleting_at, this.deletionNotifyTime)
    ) {
      const toShutdownTime = formatDistanceToNowStrict(new Date(workspace.deleting_at))
      vscode.window.showInformationMessage(`${workspace.name} is scheduled for deletion in ${toShutdownTime}.`)
      this.notifiedDeletion = true
    }
  }

  private maybeNotifyNotRunning(workspace: Workspace) {
    if (workspace.latest_build.status !== "running") {
      vscode.window.showInformationMessage(
        "Your workspace is no longer running!",
        {
          detail: "Reloading the window to reconnect.",
        },
        "Reload Window",
      ).then((action) => {
        if (!action) {
          return
        }
        vscode.commands.executeCommand("workbench.action.reloadWindow")
      })
    }
  }

  private isImpending(target: string, notifyTime: number): boolean {
    const nowTime = new Date().getTime()
    const targetTime = new Date(target).getTime()
    const timeLeft = targetTime - nowTime
    return timeLeft >= 0 && timeLeft <= notifyTime
  }

  private maybeNotifyOutdated(workspace: Workspace) {
    if (!this.notifiedOutdated && workspace.outdated) {
      this.notifiedOutdated = true
      this.restClient
        .getTemplate(workspace.template_id)
        .then((template) => {
          return this.restClient.getTemplateVersion(template.active_version_id)
        })
        .then((version) => {
          const infoMessage = version.message
            ? `A new version of your workspace is available: ${version.message}`
            : "A new version of your workspace is available."
          vscode.window.showInformationMessage(infoMessage, "Update").then((action) => {
            if (action === "Update") {
              vscode.commands.executeCommand("coder.workspace.update", workspace, this.restClient)
            }
          })
        })
    }
  }

  private notifyError(error: unknown) {
    const message = errToStr(error, "No error message was provided")
    this.storage.writeToCoderOutputChannel(message)
    vscode.window.showErrorMessage(`Failed to monitor workspace: ${message}`)
  }

  private updateContext(workspace: Workspace) {
    vscode.commands.executeCommand("setContext", "coder.workspace.updatable", workspace.outdated)
  }

  private updateStatusBar(workspace: Workspace) {
    if (!workspace.outdated) {
      this.updateStatusBarItem.hide()
    } else {
      this.updateStatusBarItem.show()
    }
  }
}
