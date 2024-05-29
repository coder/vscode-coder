import { isAxiosError } from "axios"
import { Api } from "coder/site/src/api/api"
import { Workspace, WorkspacesResponse, WorkspaceBuild } from "coder/site/src/api/typesGenerated"
import { formatDistanceToNowStrict } from "date-fns"
import * as vscode from "vscode"
import { Storage } from "./storage"

interface NotifiedWorkspace {
  workspace: Workspace
  wasNotified: boolean
  impendingActionDeadline: string
}

type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>

type WorkspaceWithDeadline = Workspace & { latest_build: WithRequired<WorkspaceBuild, "deadline"> }
type WorkspaceWithDeletingAt = WithRequired<Workspace, "deleting_at">

export class WorkspaceAction {
  // We use this same interval in the Dashboard to poll for updates on the Workspaces page.
  #POLL_INTERVAL: number = 1000 * 5
  #fetchWorkspacesInterval?: ReturnType<typeof setInterval>

  #ownedWorkspaces: readonly Workspace[] = []
  #workspacesApproachingAutostop: NotifiedWorkspace[] = []
  #workspacesApproachingDeletion: NotifiedWorkspace[] = []

  private constructor(
    private readonly vscodeProposed: typeof vscode,
    private readonly restClient: Api,
    private readonly storage: Storage,
    ownedWorkspaces: readonly Workspace[],
  ) {
    this.#ownedWorkspaces = ownedWorkspaces

    // seed initial lists
    this.updateNotificationLists()

    this.notifyAll()

    // set up polling so we get current workspaces data
    this.pollGetWorkspaces()
  }

  static async init(vscodeProposed: typeof vscode, restClient: Api, storage: Storage) {
    // fetch all workspaces owned by the user and set initial public class fields
    let ownedWorkspacesResponse: WorkspacesResponse
    try {
      ownedWorkspacesResponse = await restClient.getWorkspaces({ q: "owner:me" })
    } catch (error) {
      let status
      if (isAxiosError(error)) {
        status = error.response?.status
      }
      if (status !== 401) {
        storage.writeToCoderOutputChannel(
          `Failed to fetch owned workspaces. Some workspace notifications may be missing: ${error}`,
        )
      }

      ownedWorkspacesResponse = { workspaces: [], count: 0 }
    }
    return new WorkspaceAction(vscodeProposed, restClient, storage, ownedWorkspacesResponse.workspaces)
  }

  updateNotificationLists() {
    this.#workspacesApproachingAutostop = this.#ownedWorkspaces
      .filter(this.filterWorkspacesImpendingAutostop)
      .map((workspace) =>
        this.transformWorkspaceObjects(workspace, this.#workspacesApproachingAutostop, workspace.latest_build.deadline),
      )

    this.#workspacesApproachingDeletion = this.#ownedWorkspaces
      .filter(this.filterWorkspacesImpendingDeletion)
      .map((workspace) =>
        this.transformWorkspaceObjects(workspace, this.#workspacesApproachingDeletion, workspace.deleting_at),
      )
  }

  filterWorkspacesImpendingAutostop(workspace: Workspace): workspace is WorkspaceWithDeadline {
    // a workspace is eligible for autostop if the workspace is running and it has a deadline
    if (workspace.latest_build.status !== "running" || !workspace.latest_build.deadline) {
      return false
    }

    const halfHourMilli = 1000 * 60 * 30
    // return workspaces with a deadline that is in 30 min or less
    return Math.abs(new Date().getTime() - new Date(workspace.latest_build.deadline).getTime()) <= halfHourMilli
  }

  filterWorkspacesImpendingDeletion(workspace: Workspace): workspace is WorkspaceWithDeletingAt {
    if (!workspace.deleting_at) {
      return false
    }

    const dayMilli = 1000 * 60 * 60 * 24

    // return workspaces with a deleting_at that is 24 hrs or less
    return Math.abs(new Date().getTime() - new Date(workspace.deleting_at).getTime()) <= dayMilli
  }

  transformWorkspaceObjects(workspace: Workspace, workspaceList: NotifiedWorkspace[], deadlineField: string) {
    const wasNotified = workspaceList.find((nw) => nw.workspace.id === workspace.id)?.wasNotified ?? false
    const impendingActionDeadline = formatDistanceToNowStrict(new Date(deadlineField))
    return { workspace, wasNotified, impendingActionDeadline }
  }

  async pollGetWorkspaces() {
    let errorCount = 0
    this.#fetchWorkspacesInterval = setInterval(async () => {
      try {
        const workspacesResult = await this.restClient.getWorkspaces({ q: "owner:me" })
        this.#ownedWorkspaces = workspacesResult.workspaces
        this.updateNotificationLists()
        this.notifyAll()
      } catch (error) {
        errorCount++

        let status
        if (isAxiosError(error)) {
          status = error.response?.status
        }
        if (status !== 401) {
          this.storage.writeToCoderOutputChannel(
            `Failed to poll owned workspaces. Some workspace notifications may be missing: ${error}`,
          )
        }
        if (errorCount === 3) {
          clearInterval(this.#fetchWorkspacesInterval)
        }
      }
    }, this.#POLL_INTERVAL)
  }

  notifyAll() {
    this.notifyImpendingAutostop()
    this.notifyImpendingDeletion()
  }

  notifyImpendingAutostop() {
    this.#workspacesApproachingAutostop?.forEach((notifiedWorkspace: NotifiedWorkspace) => {
      if (notifiedWorkspace.wasNotified) {
        // don't message the user; we've already messaged
        return
      }

      // we display individual notifications for each workspace as VS Code
      // intentionally strips new lines from the message text
      // https://github.com/Microsoft/vscode/issues/48900
      this.vscodeProposed.window.showInformationMessage(
        `${notifiedWorkspace.workspace.name} is scheduled to shut down in ${notifiedWorkspace.impendingActionDeadline}.`,
      )
      notifiedWorkspace.wasNotified = true
    })
  }

  notifyImpendingDeletion() {
    this.#workspacesApproachingDeletion?.forEach((notifiedWorkspace: NotifiedWorkspace) => {
      if (notifiedWorkspace.wasNotified) {
        // don't message the user; we've already messaged
        return
      }

      // we display individual notifications for each workspace as VS Code
      // intentionally strips new lines from the message text
      // https://github.com/Microsoft/vscode/issues/48900
      this.vscodeProposed.window.showInformationMessage(
        `${notifiedWorkspace.workspace.name} is scheduled for deletion in ${notifiedWorkspace.impendingActionDeadline}.`,
      )
      notifiedWorkspace.wasNotified = true
    })
  }

  cleanupWorkspaceActions() {
    clearInterval(this.#fetchWorkspacesInterval)
  }
}
