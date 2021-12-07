"use strict"

import * as qs from "querystring"
import * as vscode from "vscode"
import { CoderHelpProvider } from "./help"

import {
  coderWorkspaceInspectDocumentProvider,
  coderWorkspaceLogsDocumentProvider,
  handleInspectCommand,
  handleShowLogsCommand,
} from "./logs"
import { context, debug, getQueryValue } from "./utils"
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
    // Note that VS Code's `uri.query` is decoded (by contrast `URL.search` is
    // not decoded meaning VS Code's behavior seems incorrect) which means
    // anything in the query needs to be double encoded before being sent to VS
    // Code since `qs.parse()` also does decoding (things like + in the version
    // will become spaces).  For example: ?version=v1.25.0%252Bcli.1
    const query = qs.parse(uri.query)
    debug(`Handling URI: ${uri}`)
    switch (action) {
      case "open-workspace": {
        return openWorkspace(resource, {
          accessUri: getQueryValue(query.accessUri),
          token: getQueryValue(query.token),
          version: getQueryValue(query.version),
        })
      }
      default:
        vscode.window.showErrorMessage(`Unknown action "${action}"`)
        break
    }
  },
}

export function activate(ctx: vscode.ExtensionContext): void {
  context(ctx)

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
