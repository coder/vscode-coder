import { getWorkspaces } from "coder/site/src/api/api"
import * as path from "path"
import * as vscode from "vscode"

export class WorkspaceProvider implements vscode.TreeDataProvider<TreeItem> {
  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: TreeItem): Thenable<TreeItem[]> {
    if (!element) {
      return Promise.resolve([
        new TreeItem("My Workspaces", vscode.TreeItemCollapsibleState.Expanded),
        new TreeItem("All Workspaces", vscode.TreeItemCollapsibleState.None),
      ])
    }
    if (element.label === "My Workspaces") {
      return getWorkspaces({
        q: "owner:me",
      }).then((workspaces) => {
        return workspaces.workspaces.map(
          (workspace) => new TreeItem(workspace.name, vscode.TreeItemCollapsibleState.None),
        )
      })
    }
    if (element.label === "All Workspaces") {
      return getWorkspaces({
        q: "owner:all",
      }).then((workspaces) => {
        const exampleWorkspaces = [{ name: "example1" }, { name: "example2" }]
        return [...workspaces.workspaces, ...exampleWorkspaces].map(
          (workspace) => new TreeItem(workspace.name, vscode.TreeItemCollapsibleState.None),
        )
      })
    }
    return Promise.resolve([])
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
