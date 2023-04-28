import { getWorkspaces } from "coder/site/src/api/api"
import { WorkspaceAgent } from "coder/site/src/api/typesGenerated"
import * as path from "path"
import * as vscode from "vscode"
import { extractAgents } from "./api-helper"

export enum WorkspaceQuery {
  Mine = "owner:me",
  All = "",
}

export class WorkspaceProvider implements vscode.TreeDataProvider<WorkspaceTreeItem> {
  constructor(private readonly getWorkspacesQuery: WorkspaceQuery) {}

  private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceTreeItem | undefined | null | void> =
    new vscode.EventEmitter<WorkspaceTreeItem | undefined | null | void>()
  readonly onDidChangeTreeData: vscode.Event<WorkspaceTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: WorkspaceTreeItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: WorkspaceTreeItem): Thenable<WorkspaceTreeItem[]> {
    if (element) {
      if (element.agents.length > 0) {
        return Promise.resolve(
          element.agents.map((agent) => {
            const label = agent.name
            const detail = `Status: ${agent.status}`
            return new WorkspaceTreeItem(label, detail, "", "", agent.name, agent.expanded_directory, [], "coderAgent")
          }),
        )
      }
      return Promise.resolve([])
    }
    return getWorkspaces({ q: this.getWorkspacesQuery }).then((workspaces) => {
      return workspaces.workspaces.map((workspace) => {
        const status =
          workspace.latest_build.status.substring(0, 1).toUpperCase() + workspace.latest_build.status.substring(1)

        const label =
          this.getWorkspacesQuery === WorkspaceQuery.All
            ? `${workspace.owner_name} / ${workspace.name}`
            : workspace.name
        const detail = `Template: ${workspace.template_display_name || workspace.template_name} • Status: ${status}`
        const agents = extractAgents(workspace)
        return new WorkspaceTreeItem(
          label,
          detail,
          workspace.owner_name,
          workspace.name,
          undefined,
          agents[0]?.expanded_directory,
          agents,
          agents.length > 1 ? "coderWorkspaceMultipleAgents" : "coderWorkspaceSingleAgent",
        )
      })
    })
  }
}

type CoderTreeItemType = "coderWorkspaceSingleAgent" | "coderWorkspaceMultipleAgents" | "coderAgent"

export class WorkspaceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly tooltip: string,
    public readonly workspaceOwner: string,
    public readonly workspaceName: string,
    public readonly workspaceAgent: string | undefined,
    public readonly workspaceFolderPath: string | undefined,
    public readonly agents: WorkspaceAgent[],
    contextValue: CoderTreeItemType,
  ) {
    super(
      label,
      contextValue === "coderWorkspaceMultipleAgents"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    )
    this.contextValue = contextValue
  }

  iconPath = {
    light: path.join(__filename, "..", "..", "media", "logo.svg"),
    dark: path.join(__filename, "..", "..", "media", "logo.svg"),
  }
}
