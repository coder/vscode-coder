import { getWorkspaces } from "coder/site/src/api/api"
import * as path from "path"
import * as vscode from "vscode"

export class WorkspaceProvider implements vscode.TreeDataProvider<Dependency> {
  getTreeItem(element: Dependency): vscode.TreeItem {
    return element
  }

  getChildren(): Thenable<Dependency[]> {
    return getWorkspaces({
      q: "owner:me",
    }).then((workspaces) => {
      const exampleWorkspaces = [{ name: "example1" }, { name: "example2" }]
      return [...workspaces.workspaces, ...exampleWorkspaces].map(
        (workspace) => new Dependency(workspace.name, vscode.TreeItemCollapsibleState.None),
      )
    })
  }
}

class Dependency extends vscode.TreeItem {
  constructor(public readonly label: string, public readonly collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState)
    this.tooltip = `${this.label}`
  }

  iconPath = {
    light: path.join(__filename, "..", "..", "media", "logo.svg"),
    dark: path.join(__filename, "..", "..", "media", "logo.svg"),
  }
}
