import { getWorkspaces } from "coder/site/src/api/api"
import * as vscode from "vscode"

export class WorkspacesProvider implements vscode.TreeDataProvider<Workspace> {
  private _onDidChangeTreeData: vscode.EventEmitter<Workspace | undefined | void> = new vscode.EventEmitter<
    Workspace | undefined | void
  >()
  readonly onDidChangeTreeData: vscode.Event<Workspace | undefined | void> = this._onDidChangeTreeData.event
  constructor() {
    // intentional blank link for ESLint
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: Workspace): vscode.TreeItem {
    return element
  }

  async getChildren(): Promise<Workspace[]> {
    const workspaces = await getWorkspaces({
      q: "owner:me",
    }).catch(() => {
      // TODO: we should probably warn or error here
      return
    })

    if (workspaces) {
      const items: Workspace[] = workspaces.workspaces.map((workspace) => {
        return new Workspace(
          `${workspace.name}`,
          vscode.TreeItemCollapsibleState.None,
          `${workspace.latest_build.status !== "running" ? "circle-outline" : "circle-filled"}`,
          {
            command: "coder.open",
            title: "",
            arguments: [workspace.owner_name, workspace.name],
          },
        )
      })

      return Promise.resolve(items)
    } else {
      // TODO: should we issue a warning new workspaces found?
      // Or return a link to create a new Workspace from the dashboard?
      return Promise.resolve([])
    }
  }
}

export class Workspace extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly iconId: vscode.ThemeIcon["id"],
    public readonly command?: vscode.Command,
  ) {
    super(label, collapsibleState)

    this.tooltip = `${this.label}`
  }

  iconPath = new vscode.ThemeIcon(this.iconId)
}
