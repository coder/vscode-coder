"use strict"

import { getUser } from "coder/site/src/api/api"
import { readFileSync } from "fs"
import * as module from "module"
import path from "path"
import * as vscode from "vscode"
import { Commands } from "./commands"
import { Remote } from "./remote"
import { Storage } from "./storage"

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const productJSON = readFileSync(path.join(vscode.env.appRoot, "product.json"))
  const product = JSON.parse(productJSON.toString())
  const commit = product.commit
  const output = vscode.window.createOutputChannel("Coder")
  const storage = new Storage(output, ctx.globalState, ctx.globalStorageUri)
  storage.init()

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
    handleUri: (uri) => {
      const params = new URLSearchParams(uri.query)
      if (uri.path === "/open") {
        const owner = params.get("owner")
        const name = params.get("name")
        vscode.commands.executeCommand("coder.open", owner, name)
      }
    },
  })

  const commands = new Commands(storage)

  vscode.commands.registerCommand("coder.login", commands.login.bind(commands))
  vscode.commands.registerCommand("coder.logout", commands.logout.bind(commands))
  vscode.commands.registerCommand("coder.open", commands.open.bind(commands))

  // The remote SSH extension is required to provide the restricted
  // proposed API for registering remote authority providers.
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

  const remote = new Remote(output, vscodeProposed, storage, commit)
  ctx.subscriptions.push(remote)

  vscodeProposed.workspace.registerRemoteAuthorityResolver("coder", remote)
}
