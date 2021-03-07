"use strict"

import * as vscode from "vscode"
import { CoderHelpProvider } from "./help"
import * as which from "which"

import {
  CoderWorkspacesProvider,
  CoderWorkspace,
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

const preflightCheckCoderInstalled = () => {
  which("coder", (err: any) => {
    if (err) {
      vscode.window.showErrorMessage(
        `"coder" CLI not found in $PATH. Please follow the install and authentication instructions here: https://coder.com/docs/cli/installation`,
        "Dismiss",
      )
    }
  })
}
