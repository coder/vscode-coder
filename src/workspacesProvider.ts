import { getWorkspaces } from "coder/site/src/api/api"
import * as path from "path"
import * as vscode from "vscode"

export class WorkspaceProvider implements vscode.TreeDataProvider<TreeItem> {
  constructor(private readonly getWorkspacesQuery?: string) {}
  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): Thenable<TreeItem[]> {
    return getWorkspaces({ q: this.getWorkspacesQuery }).then((workspaces) => {
      return workspaces.workspaces.map(
        (workspace) => new TreeItem(workspace.name, vscode.TreeItemCollapsibleState.None),
      )
    })
  }
}

class TreeItem extends vscode.TreeItem {
  constructor(public readonly label: string, public readonly collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState)
    this.tooltip = `${this.label}`
  }

  iconPath = {
    light: path.join(__filename, "..", "..", "media", "logo.svg"),
    dark: path.join(__filename, "..", "..", "media", "logo.svg"),
  }
}
