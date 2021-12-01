"use strict"

import * as vscode from "vscode"
import { CoderHelpProvider } from "./help"

import {
  coderWorkspaceInspectDocumentProvider,
  coderWorkspaceLogsDocumentProvider,
  handleInspectCommand,
  handleShowLogsCommand,
} from "./logs"
import { coderBinary, execCombined, binaryExists } from "./utils"
import {
  CoderWorkspacesProvider,
  rebuildWorkspace,
  openWorkspace,
  shutdownWorkspace,
  CoderWorkspaceListItem,
} from "./workspaces"

export const uriHandler: vscode.UriHandler = {
  // URIs look like this: vscode://extension-id/action/resource
  // To manually test this you can use "Open URL" from the command pallete or
  // use `code --open-url` from the command line.
  handleUri(uri: vscode.Uri) {
    // fsPath will be /action/resource.  Remove the leading slash so we can
    // split on the first non-leading trailing slash which separates the
    // action from the resource.  The action is not allowed to contain slashes
    // but the resource can.
    const [action, resource] = uri.fsPath.replace(/^\//, "").split("/")
    if (!action || !resource) {
      vscode.window.showErrorMessage(`URI is malformed: "${uri}"`)
      return
    }
    switch (action) {
      case "open-workspace":
        openWorkspace(resource)
        break
      default:
        vscode.window.showErrorMessage(`Unknown action "${action}"`)
        break
    }
  },
}

export function activate(): void {
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

  vscode.window.registerUriHandler(uriHandler)
}

export const outputChannel = vscode.window.createOutputChannel("Coder")

const preflightCheckCoderInstalled = async () => {
  const coderExists = await binaryExists(coderBinary)
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
      const coderExists = await binaryExists(coderBinary)
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
