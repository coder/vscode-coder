"use strict"

import * as vscode from "vscode"
import { CoderHelpProvider } from "./help"

import {
  CoderWorkspacesProvider,
  rebuildWorkspace,
  openWorkspace,
  shutdownWorkspace,
  CoderWorkspaceListItem,
} from "./workspaces"
import {
  coderWorkspaceInspectDocumentProvider,
  coderWorkspaceLogsDocumentProvider,
  handleInspectCommand,
  handleShowLogsCommand,
} from "./logs"
import { execCombined, binaryExists } from "./utils"

export function activate(context: vscode.ExtensionContext) {
  preflightCheckCoderInstalled()

  const workspaceProvider = new CoderWorkspacesProvider()

  vscode.commands.registerCommand("coderWorkspaces.showWorkspaceLogs", handleShowLogsCommand)
  vscode.commands.registerCommand("coderWorkspaces.showWorkspaceYaml", handleInspectCommand)

  vscode.window.registerTreeDataProvider("coderWorkspaces", workspaceProvider)
  vscode.window.registerTreeDataProvider("coderHelpFeedback", new CoderHelpProvider())
  vscode.commands.registerCommand("coderWorkspaces.openWorkspace", (item: CoderWorkspaceListItem) => {
    const { name } = item.workspace
    openWorkspace(name)
  })
  vscode.commands.registerCommand("coderWorkspaces.rebuildWorkspace", (item: CoderWorkspaceListItem) => {
    const { name } = item.workspace
    rebuildWorkspace(name).then(() => workspaceProvider.refresh())
  })
  vscode.commands.registerCommand("coderWorkspaces.shutdownWorkspace", (item: CoderWorkspaceListItem) => {
    const { name } = item.workspace
    shutdownWorkspace(name).then(() => workspaceProvider.refresh())
  })

  vscode.commands.registerCommand("coderWorkspaces.refreshWorkspaces", () => {
    workspaceProvider.refresh()
  })

  vscode.workspace.registerTextDocumentContentProvider("coder-logs", coderWorkspaceLogsDocumentProvider)
  vscode.workspace.registerTextDocumentContentProvider("coder-inspect", coderWorkspaceInspectDocumentProvider)
}

export const outputChannel = vscode.window.createOutputChannel("Coder")

const preflightCheckCoderInstalled = async () => {
  const coderExists = await binaryExists("coder")
  if (coderExists) {
    return
  }
  const brewExists = await binaryExists("brew")
  if (!brewExists) {
    vscode.window.showErrorMessage(
      `"coder" CLI not found in $PATH. Please follow the install and authentication [instructions here](https://coder.com/docs/cli/installation).`,
      "Dismiss",
    )
  } else {
    const action = await vscode.window.showErrorMessage(`"coder" CLI not found in $PATH`, "Install with `brew`")
    if (action) {
      outputChannel.show()
      const cmd = "brew install cdr/coder/coder-cli"
      outputChannel.appendLine(cmd)
      const output = await execCombined(cmd)
      outputChannel.appendLine(output.stderr)
      const coderExists = await binaryExists("coder")
      if (coderExists) {
        outputChannel.appendLine(
          'Installation successful.\nACTION REQUIRED: run "coder login [https://coder.domain.com]"',
        )
      } else {
        outputChannel.appendLine(`Install failed. "coder" still not found in $PATH.`)
      }
    }
  }
}
