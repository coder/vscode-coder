"use strict"
import axios from "axios"
import { getAuthenticatedUser } from "coder/site/src/api/api"
import fs from "fs"
import * as https from "https"
import * as module from "module"
import * as vscode from "vscode"
import { Commands } from "./commands"
import { CertificateError } from "./error"
import { Remote } from "./remote"
import { Storage } from "./storage"
import { WorkspaceQuery, WorkspaceProvider } from "./workspacesProvider"

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
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

  // applyHttpProperties is called on extension activation and when the
  // insecure or TLS setting are changed. It updates the https agent to allow
  // self-signed certificates if the insecure setting is true, as well as
  // adding cert/key/ca properties for TLS.
  const applyHttpProperties = () => {
    const cfg = vscode.workspace.getConfiguration()
    const insecure = Boolean(cfg.get("coder.insecure"))
    const certFile = String(cfg.get("coder.tlsCertFile") ?? "").trim()
    const keyFile = String(cfg.get("coder.tlsKeyFile") ?? "").trim()
    const caFile = String(cfg.get("coder.tlsCaFile") ?? "").trim()

    axios.defaults.httpsAgent = new https.Agent({
      cert: certFile === "" ? undefined : fs.readFileSync(certFile),
      key: keyFile === "" ? undefined : fs.readFileSync(keyFile),
      ca: caFile === "" ? undefined : fs.readFileSync(caFile),
      // rejectUnauthorized defaults to true, so we need to explicitly set it to false
      // if we want to allow self-signed certificates.
      rejectUnauthorized: !insecure,
    })
  }

  axios.interceptors.response.use(
    (r) => r,
    async (err) => {
      throw await CertificateError.maybeWrap(err, axios.getUri(err.config), storage)
    },
  )

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration("coder.insecure") ||
      e.affectsConfiguration("coder.tlsCertFile") ||
      e.affectsConfiguration("coder.tlsKeyFile") ||
      e.affectsConfiguration("coder.tlsCaFile")
    ) {
      applyHttpProperties()
    }
  })
  applyHttpProperties()

  const output = vscode.window.createOutputChannel("Coder")
  const storage = new Storage(output, ctx.globalState, ctx.secrets, ctx.globalStorageUri, ctx.logUri)
  await storage.init()

  // Add headers from the header command.
  axios.interceptors.request.use(async (config) => {
    Object.entries(await storage.getHeaders(config.baseURL || axios.getUri(config))).forEach(([key, value]) => {
      config.headers[key] = value
    })
    return config
  })

  const myWorkspacesProvider = new WorkspaceProvider(WorkspaceQuery.Mine, storage)
  const allWorkspacesProvider = new WorkspaceProvider(WorkspaceQuery.All, storage)

  vscode.window.registerTreeDataProvider("myWorkspaces", myWorkspacesProvider)
  vscode.window.registerTreeDataProvider("allWorkspaces", allWorkspacesProvider)

  const url = storage.getURL()
  if (url) {
    getAuthenticatedUser()
      .then(async (user) => {
        if (user && user.roles) {
          vscode.commands.executeCommand("setContext", "coder.authenticated", true)
          if (user.roles.find((role) => role.name === "owner")) {
            await vscode.commands.executeCommand("setContext", "coder.isOwner", true)
          }
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
  const remote = new Remote(vscodeProposed, storage, ctx.extensionMode)
  try {
    await remote.setup(vscodeProposed.env.remoteAuthority)
  } catch (ex) {
    if (ex instanceof CertificateError) {
      return await ex.showModal("Failed to open workspace")
    }
    await vscodeProposed.window.showErrorMessage("Failed to open workspace", {
      detail: (ex as string).toString(),
      modal: true,
      useCustom: true,
    })
  }
}
