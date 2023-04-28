import { getWorkspaces } from "coder/site/src/api/api"
import * as path from "path"
import * as vscode from "vscode"
import { extractAgentsAndFolderPath } from "./api-helper"

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

  getChildren(): Thenable<WorkspaceTreeItem[]> {
    return getWorkspaces({ q: this.getWorkspacesQuery }).then((workspaces) => {
      return workspaces.workspaces.map((workspace) => {
        const status =
          workspace.latest_build.status.substring(0, 1).toUpperCase() + workspace.latest_build.status.substring(1)

        const label =
          this.getWorkspacesQuery === WorkspaceQuery.All
            ? `${workspace.owner_name} / ${workspace.name}`
            : workspace.name
        const detail = `Template: ${workspace.template_display_name || workspace.template_name} • Status: ${status}`
        const [, folderPath] = extractAgentsAndFolderPath(workspace)
        return new WorkspaceTreeItem(label, detail, workspace.owner_name, workspace.name, folderPath)
      })
    })
  }
}

export class WorkspaceTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly tooltip: string,
    public readonly workspaceOwner: string,
    public readonly workspaceName: string,
    public readonly workspaceFolderPath: string | undefined,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None)
  }

  iconPath = {
    light: path.join(__filename, "..", "..", "media", "logo.svg"),
    dark: path.join(__filename, "..", "..", "media", "logo.svg"),
  }
}
