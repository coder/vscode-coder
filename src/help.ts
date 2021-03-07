import * as vscode from "vscode"
import * as path from "path"

export class CoderHelpProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >()
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event

  constructor() {
    this.refresh()
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    return Promise.resolve([
      makeSimpleLink("Read the Coder Documentation", "books.svg", "https://coder.com/docs"),
      makeSimpleLink("Watch Coder on YouTube", "video.svg", "https://www.youtube.com/channel/UCWexK_ECcUU3vEIdb-VYkfw"),
      makeSimpleLink("Contact Us", "feedback.svg", "https://coder.com/contact"),
    ])
  }
}

const makeSimpleLink = (label: string, icon: string, url: string): vscode.TreeItem => {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None)
  item.iconPath = {
    dark: path.join(__filename, "..", "..", "media", "dark", icon),
    light: path.join(__filename, "..", "..", "media", "light", icon),
  }
  item.command = {
    title: label,
    command: "vscode.open",
    arguments: [vscode.Uri.parse(url)],
  }
  return item
}
