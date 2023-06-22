import { getWorkspaces } from "coder/site/src/api/api"
import { Workspace, WorkspacesResponse } from "coder/site/src/api/typesGenerated"
import { formatDistanceToNowStrict } from "date-fns"
import * as vscode from "vscode"

interface NotifiedWorkspace {
  workspace: Workspace
  wasNotified: boolean
  impendingActionDeadline: string
}

export class WorkspaceAction {
  #fetchWorkspacesInterval?: ReturnType<typeof setInterval>

  #ownedWorkspaces: Workspace[] = []
  #workspacesApproachingAutostop: NotifiedWorkspace[] = []
  #workspacesApproachingDeletion: NotifiedWorkspace[] = []

  private constructor(private readonly vscodeProposed: typeof vscode, ownedWorkspaces: Workspace[]) {
    this.#ownedWorkspaces = ownedWorkspaces

    // seed initial lists
    this.seedNotificationLists()

    this.notifyAll()

    // set up polling so we get current workspaces data
    this.pollGetWorkspaces()
  }

  static async init(vscodeProposed: typeof vscode) {
    // fetch all workspaces owned by the user and set initial public class fields
    let ownedWorkspacesResponse: WorkspacesResponse
    try {
      ownedWorkspacesResponse = await getWorkspaces({ q: "owner:me" })
    } catch (error) {
      ownedWorkspacesResponse = { workspaces: [], count: 0 }
    }
    return new WorkspaceAction(vscodeProposed, ownedWorkspacesResponse.workspaces)
  }

  seedNotificationLists() {
    this.#workspacesApproachingAutostop = this.#ownedWorkspaces
      .filter(this.filterWorkspacesImpendingAutostop)
      .map((workspace: Workspace) => this.transformWorkspaceObjects(workspace, workspace.latest_build.deadline))

    this.#workspacesApproachingDeletion = this.#ownedWorkspaces
      .filter(this.filterWorkspacesImpendingDeletion)
      .map((workspace: Workspace) => this.transformWorkspaceObjects(workspace, workspace.deleting_at))
  }

  filterWorkspacesImpendingAutostop(workspace: Workspace) {
    // a workspace is eligible for autostop if the last build was successful,
    // and the workspace is started,
    // and it has a deadline
    if (
      workspace.latest_build.job.status !== "succeeded" ||
      workspace.latest_build.transition !== "start" ||
      !workspace.latest_build.deadline
    ) {
      return false
    }

    const hourMilli = 1000 * 60 * 60
    // return workspaces with a deadline that is in 1 hr or less
    return Math.abs(new Date().getTime() - new Date(workspace.latest_build.deadline).getTime()) <= hourMilli
  }

  filterWorkspacesImpendingDeletion(workspace: Workspace) {
    if (!workspace.deleting_at) {
      return
    }

    const dayMilli = 1000 * 60 * 60 * 24

    // return workspaces with a deleting_at  that is 24 hrs or less
    return Math.abs(new Date().getTime() - new Date(workspace.deleting_at).getTime()) <= dayMilli
  }

  transformWorkspaceObjects(workspace: Workspace, deadlineField?: string) {
    // the below line is to satisfy TS; we should always pass a deadlineField, e.g
    // workspace,deleting_at or workspace.latest_build.deadline
    if (!deadlineField) {
      return { workspace, wasNotified: true, impendingActionDeadline: "" }
    }
    const wasNotified =
      this.#workspacesApproachingAutostop.find((wn) => wn.workspace.id === workspace.id)?.wasNotified ?? false
    const impendingActionDeadline = formatDistanceToNowStrict(new Date(deadlineField))
    return { workspace, wasNotified, impendingActionDeadline }
  }

  async pollGetWorkspaces() {
    let errorCount = 0
    this.#fetchWorkspacesInterval = setInterval(async () => {
      try {
        const workspacesResult = await getWorkspaces({ q: "owner:me" })
        this.#ownedWorkspaces = workspacesResult.workspaces
        this.seedNotificationLists()
        this.notifyAll()
      } catch (error) {
        if (errorCount === 3) {
          clearInterval(this.#fetchWorkspacesInterval)
        }
        errorCount++
      }
    }, 1000 * 5)
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
