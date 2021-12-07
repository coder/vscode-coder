import * as vscode from "vscode"
import * as yaml from "yaml"
import { execCoder } from "./exec"
import { CoderWorkspace } from "./workspaces"

export const handleShowLogsCommand = async ({ workspace }: { workspace: CoderWorkspace }): Promise<void> => {
  const uri = vscode.Uri.parse("coder-logs:" + workspace.name)
  const doc = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(doc, { preview: false })
}

export const coderWorkspaceLogsDocumentProvider = new (class implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // TODO: Write to document as text comes in instead of waiting.
    // TODO: add a --no-follow flag for cases where a build is in-progress
    return execCoder(`envs watch-build ${uri.fsPath}`)
  }
})()

export const handleInspectCommand = async ({ workspace }: { workspace: CoderWorkspace }): Promise<void> => {
  const uri = vscode.Uri.parse("coder-inspect:" + workspace.name + ".yaml")
  const doc = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(doc, { preview: false })
}

export const coderWorkspaceInspectDocumentProvider = new (class implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // TODO: Write to document as text comes in instead of waiting.
    // TODO: add a --no-follow flag for cases where a build is in-progress
    const envs: CoderWorkspace[] = JSON.parse(await execCoder(`envs ls --output json`))
    const env = envs.find((e) => e.name === uri.fsPath.replace(".yaml", ""))
    return yaml.stringify(env)
  }
})()
