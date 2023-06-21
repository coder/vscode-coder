import { Workspace, WorkspacesResponse } from "coder/site/src/api/typesGenerated"
import { getWorkspaces } from "coder/site/src/api/api"
import * as vscode from "vscode"

interface NotifiedWorkspace {
  workspace: Workspace
  wasNotified: boolean
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
      .filter(this.filterImpendingAutostopWorkspaces)
      .map((workspace: Workspace) => {
        const wasNotified =
          this.#workspacesApproachingAutostop.find((wn) => wn.workspace.id === workspace.id)?.wasNotified ?? false
        return { workspace, wasNotified }
      })

    // NOTE: this feature is currently in-progess; however, we're including scaffolding for it
    // to exemplify the class pattern used for Workspace Actions
    this.#workspacesApproachingDeletion = []
  }

  filterImpendingAutostopWorkspaces(workspace: Workspace) {
    if (workspace.latest_build.transition !== "start" || !workspace.latest_build.deadline) {
      return false
    }

    const hoursMilli = 1000 * 60 * 60
    // return workspaces with a deadline that is in 1 hr or less
    return Math.abs(new Date().getTime() - new Date(workspace.latest_build.deadline).getTime()) <= hoursMilli
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
        `${notifiedWorkspace.workspace.name} is scheduled to shut down in 1 hour.`,
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
        `${notifiedWorkspace.workspace.name} is scheduled for deletion.`,
      )
      notifiedWorkspace.wasNotified = true
    })
  }

  cleanupWorkspaceActions() {
    clearInterval(this.#fetchWorkspacesInterval)
  }
}
