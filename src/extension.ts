"use strict"

import { getUser } from "coder/site/src/api/api"
import * as module from "module"
import * as vscode from "vscode"
import { Commands } from "./commands"
import { Remote } from "./remote"
import { Storage } from "./storage"

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Coder")
  const storage = new Storage(output, ctx.globalState, ctx.secrets, ctx.globalStorageUri, ctx.logUri)
  await storage.init()

  getUser()
    .then(() => {
      vscode.commands.executeCommand("setContext", "coder.authenticated", true)
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
        vscode.commands.executeCommand("coder.open", owner, workspace, agent)
      }
    },
  })

  const commands = new Commands(storage)

  vscode.commands.registerCommand("coder.login", commands.login.bind(commands))
  vscode.commands.registerCommand("coder.logout", commands.logout.bind(commands))
  vscode.commands.registerCommand("coder.open", commands.open.bind(commands))

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

  // Since the "onResolveRemoteAuthority:ssh-remote" activation event exists
  // in package.json we're able to perform actions before the authority is
  // resolved by the remote SSH extension.
  const activeRemotes = vscode.workspace.workspaceFolders?.filter((folder) => folder.uri.scheme === "vscode-remote")
  // If the currently opened folder isn't remote we can return early!
  if (activeRemotes?.length !== 1) {
    return
  }
  const activeRemote = activeRemotes[0].uri

  ctx.globalStorageUri

  const remote = new Remote(vscodeProposed, storage, ctx.extensionMode)
  await remote.setup(activeRemote)
}
