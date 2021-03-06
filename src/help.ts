import * as vscode from 'vscode';
import * as path from 'path';

export class CoderHelpProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

	constructor() {
		this.refresh();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    return Promise.resolve([
      docsLink(),
    ]);
	}
}

const docsLink = (): vscode.TreeItem => {
  const item = new vscode.TreeItem("Read the Coder Documentation", vscode.TreeItemCollapsibleState.None);
  item.iconPath = path.join(__filename, '..', '..', 'media', "docs.svg");
  item.command = {
    title: "Open Coder Documentation",
    command: "vscode.open",
    arguments: [vscode.Uri.parse('https://coder.com/docs')]
  };
  return item;
};

