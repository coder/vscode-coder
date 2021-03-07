import * as vscode from "vscode"
import * as cp from "child_process"
import { CoderWorkspace } from "./workspaces"

export const handleShowLogsCommand = async ({ workspace }: { workspace: CoderWorkspace }) => {
  const uri = vscode.Uri.parse("coder:" + workspace.name)
  const doc = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(doc, { preview: false })
}

export const coderWorkspaceLogsDocumentProvider = new (class implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    // TODO: add a --no-follow flag for cases where a build is in-progress
    const output = cp.execSync(`coder envs watch-build ${uri.fsPath}`)
    return output.toString("utf-8")
  }
})()
