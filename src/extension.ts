"use strict"
import { getAuthenticatedUser } from "coder/site/src/api/api"
import * as module from "module"
import * as vscode from "vscode"
import { Commands } from "./commands"
import { Remote } from "./remote"
import { Storage } from "./storage"
import { WorkspaceQuery, WorkspaceProvider } from "./workspacesProvider"

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Coder")
  const storage = new Storage(output, ctx.globalState, ctx.secrets, ctx.globalStorageUri, ctx.logUri)
  await storage.init()

  const myWorkspacesProvider = new WorkspaceProvider(WorkspaceQuery.Mine, storage)
  const allWorkspacesProvider = new WorkspaceProvider(WorkspaceQuery.All, storage)

  vscode.window.registerTreeDataProvider("myWorkspaces", myWorkspacesProvider)
  vscode.window.registerTreeDataProvider("allWorkspaces", allWorkspacesProvider)

  getAuthenticatedUser()
    .then(async (user) => {
      if (user) {
        vscode.commands.executeCommand("setContext", "coder.authenticated", true)
        if (user.roles.find((role) => role.name === "owner")) {
          await vscode.commands.executeCommand("setContext", "coder.isOwner", true)
        }
      }
    })
    .catch(() => {
      // Not authenticated!
    })
    .finally(() => {
      vscode.commands.executeCommand("setContext", "coder.loaded", true)
    })

  vscode.window.registerUriHandler({
    handleUri: async (uri) => {
      const params = new URLSearchParams(uri.query)
      if (uri.path === "/open") {
        const owner = params.get("owner")
        const workspace = params.get("workspace")
        const agent = params.get("agent")
        const folder = params.get("folder")
        if (!owner) {
          throw new Error("owner must be specified as a query parameter")
        }
        if (!workspace) {
          throw new Error("workspace must be specified as a query parameter")
        }

        const url = params.get("url")
        const token = params.get("token")
        if (url) {
          await storage.setURL(url)
        }
        if (token) {
          await storage.setSessionToken(token)
        }
        vscode.commands.executeCommand("coder.open", owner, workspace, agent, folder)
      }
    },
  })

  // The Remote SSH extension's proposed APIs are used to override
  // the SSH host name in VS Code itself. It's visually unappealing
  // having a lengthy name!
  //
  // This is janky, but that's alright since it provides such minimal
  // functionality to the extension.
  const remoteSSHExtension = vscode.extensions.getExtension("ms-vscode-remote.remote-ssh")
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

  const commands = new Commands(vscodeProposed, storage)

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
    myWorkspacesProvider.refresh()
    allWorkspacesProvider.refresh()
  })

  // Since the "onResolveRemoteAuthority:ssh-remote" activation event exists
  // in package.json we're able to perform actions before the authority is
  // resolved by the remote SSH extension.
  if (!vscodeProposed.env.remoteAuthority) {
    return
  }
  const remote = new Remote(vscodeProposed, storage, ctx.extensionMode)
  try {
    await remote.setup(vscodeProposed.env.remoteAuthority)
  } catch (ex) {
    await vscodeProposed.window.showErrorMessage("Failed to open workspace", {
      detail: (ex as string).toString(),
      modal: true,
      useCustom: true,
    })
  }
}
