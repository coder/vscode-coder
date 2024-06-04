"use strict"
import axios, { isAxiosError } from "axios"
import { getErrorMessage } from "coder/site/src/api/errors"
import * as module from "module"
import * as vscode from "vscode"
import { makeCoderSdk } from "./api"
import { Commands } from "./commands"
import { CertificateError, getErrorDetail } from "./error"
import { Remote } from "./remote"
import { Storage } from "./storage"
import { toSafeHost } from "./util"
import { WorkspaceQuery, WorkspaceProvider } from "./workspacesProvider"

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  // The Remote SSH extension's proposed APIs are used to override the SSH host
  // name in VS Code itself. It's visually unappealing having a lengthy name!
  //
  // This is janky, but that's alright since it provides such minimal
  // functionality to the extension.
  //
  // Prefer the anysphere.open-remote-ssh extension if it exists.  This makes
  // our extension compatible with Cursor.  Otherwise fall back to the official
  // SSH extension.
  const remoteSSHExtension =
    vscode.extensions.getExtension("anysphere.open-remote-ssh") ||
    vscode.extensions.getExtension("ms-vscode-remote.remote-ssh")
  if (!remoteSSHExtension) {
    throw new Error("Remote SSH extension not found")
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vscodeProposed: typeof vscode = (module as any)._load(
    "vscode",
    {
      filename: remoteSSHExtension?.extensionPath,
    },
    false,
  )

  const output = vscode.window.createOutputChannel("Coder")
  const storage = new Storage(output, ctx.globalState, ctx.secrets, ctx.globalStorageUri, ctx.logUri)

  // This client tracks the current login and will be used through the life of
  // the plugin to poll workspaces for the current login.
  const url = storage.getUrl()
  const restClient = await makeCoderSdk(url || "", await storage.getSessionToken(), storage)

  const myWorkspacesProvider = new WorkspaceProvider(WorkspaceQuery.Mine, restClient, 5)
  const allWorkspacesProvider = new WorkspaceProvider(WorkspaceQuery.All, restClient)

  // createTreeView, unlike registerTreeDataProvider, gives us the tree view API
  // (so we can see when it is visible) but otherwise they have the same effect.
  const wsTree = vscode.window.createTreeView("myWorkspaces", { treeDataProvider: myWorkspacesProvider })
  vscode.window.registerTreeDataProvider("allWorkspaces", allWorkspacesProvider)

  myWorkspacesProvider.setVisibility(wsTree.visible)
  wsTree.onDidChangeVisibility((event) => {
    myWorkspacesProvider.setVisibility(event.visible)
  })

  if (url) {
    restClient
      .getAuthenticatedUser()
      .then(async (user) => {
        if (user && user.roles) {
          vscode.commands.executeCommand("setContext", "coder.authenticated", true)
          if (user.roles.find((role) => role.name === "owner")) {
            await vscode.commands.executeCommand("setContext", "coder.isOwner", true)
          }

          // Fetch and monitor workspaces, now that we know the client is good.
          myWorkspacesProvider.fetchAndRefresh()
          allWorkspacesProvider.fetchAndRefresh()
        }
      })
      .catch((error) => {
        // This should be a failure to make the request, like the header command
        // errored.
        vscodeProposed.window.showErrorMessage("Failed to check user authentication: " + error.message)
      })
      .finally(() => {
        vscode.commands.executeCommand("setContext", "coder.loaded", true)
      })
  } else {
    vscode.commands.executeCommand("setContext", "coder.loaded", true)
  }

  vscode.window.registerUriHandler({
    handleUri: async (uri) => {
      const params = new URLSearchParams(uri.query)
      if (uri.path === "/open") {
        const owner = params.get("owner")
        const workspace = params.get("workspace")
        const agent = params.get("agent")
        const folder = params.get("folder")
        const openRecent =
          params.has("openRecent") && (!params.get("openRecent") || params.get("openRecent") === "true")

        if (!owner) {
          throw new Error("owner must be specified as a query parameter")
        }
        if (!workspace) {
          throw new Error("workspace must be specified as a query parameter")
        }

        // We are not guaranteed that the URL we currently have is for the URL
        // this workspace belongs to, or that we even have a URL at all (the
        // queries will default to localhost) so ask for it if missing.
        // Pre-populate in case we do have the right URL so the user can just
        // hit enter and move on.
        const url = await commands.maybeAskUrl(params.get("url"), storage.getUrl())
        if (url) {
          restClient.setHost(url)
          await storage.setURL(url)
        } else {
          throw new Error("url must be provided or specified as a query parameter")
        }

        // If the token is missing we will get a 401 later and the user will be
        // prompted to sign in again, so we do not need to ensure it is set.
        const token = params.get("token")
        if (token) {
          restClient.setSessionToken(token)
          await storage.setSessionToken(token)
        }

        // Store on disk to be used by the cli.
        await storage.configureCli(toSafeHost(url), url, token)

        vscode.commands.executeCommand("coder.open", owner, workspace, agent, folder, openRecent)
      }
    },
  })

  const commands = new Commands(vscodeProposed, restClient, storage)

  vscode.commands.registerCommand("coder.login", commands.login.bind(commands))
  vscode.commands.registerCommand("coder.logout", commands.logout.bind(commands))
  vscode.commands.registerCommand("coder.open", commands.open.bind(commands))
  vscode.commands.registerCommand("coder.openFromSidebar", commands.openFromSidebar.bind(commands))
  vscode.commands.registerCommand("coder.workspace.update", commands.updateWorkspace.bind(commands))
  vscode.commands.registerCommand("coder.createWorkspace", commands.createWorkspace.bind(commands))
  vscode.commands.registerCommand("coder.navigateToWorkspace", commands.navigateToWorkspace.bind(commands))
  vscode.commands.registerCommand(
    "coder.navigateToWorkspaceSettings",
    commands.navigateToWorkspaceSettings.bind(commands),
  )
  vscode.commands.registerCommand("coder.refreshWorkspaces", () => {
    myWorkspacesProvider.fetchAndRefresh()
    allWorkspacesProvider.fetchAndRefresh()
  })
  vscode.commands.registerCommand("coder.viewLogs", commands.viewLogs.bind(commands))

  // Since the "onResolveRemoteAuthority:ssh-remote" activation event exists
  // in package.json we're able to perform actions before the authority is
  // resolved by the remote SSH extension.
  if (!vscodeProposed.env.remoteAuthority) {
    return
  }
  const remote = new Remote(vscodeProposed, storage, commands, ctx.extensionMode)
  try {
    await remote.setup(vscodeProposed.env.remoteAuthority)
  } catch (ex) {
    if (ex instanceof CertificateError) {
      await ex.showModal("Failed to open workspace")
    } else if (isAxiosError(ex)) {
      const msg = getErrorMessage(ex, "")
      const detail = getErrorDetail(ex)
      const urlString = axios.getUri(ex.response?.config)
      let path = urlString
      try {
        path = new URL(urlString).pathname
      } catch (e) {
        // ignore, default to full url
      }
      await vscodeProposed.window.showErrorMessage("Failed to open workspace", {
        detail: `API ${ex.response?.config.method?.toUpperCase()} to '${path}' failed with code ${ex.response?.status}.\nMessage: ${msg}\nDetail: ${detail}`,
        modal: true,
        useCustom: true,
      })
    } else {
      await vscodeProposed.window.showErrorMessage("Failed to open workspace", {
        detail: (ex as string).toString(),
        modal: true,
        useCustom: true,
      })
    }
    // Always close remote session when we fail to open a workspace.
    await remote.closeRemote()
  }
}
