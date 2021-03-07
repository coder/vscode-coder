import * as vscode from "vscode"
import * as cp from "child_process"
import { CoderWorkspace } from "./workspaces"
import * as yaml from "yaml"

export const handleShowLogsCommand = async ({ workspace }: { workspace: CoderWorkspace }) => {
  const uri = vscode.Uri.parse("coder-logs:" + workspace.name)
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

export const handleInspectCommand = async ({ workspace }: { workspace: CoderWorkspace }) => {
  const uri = vscode.Uri.parse("coder-inspect:" + workspace.name + ".yaml")
  const doc = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(doc, { preview: false })
}

export const coderWorkspaceInspectDocumentProvider = new (class implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    // TODO: add a --no-follow flag for cases where a build is in-progress
    const output = cp.execSync(`coder envs ls --output json`)
    const envs: CoderWorkspace[] = JSON.parse(output.toString())
    const env = envs.find((e) => e.name === uri.fsPath.replace(".yaml", ""))!
    return yaml.stringify(env)
  }
})()
