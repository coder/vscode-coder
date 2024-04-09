"use strict"
import axios, { isAxiosError } from "axios"
import { getAuthenticatedUser } from "coder/site/src/api/api"
import { getErrorMessage } from "coder/site/src/api/errors"
import fs from "fs"
import * as https from "https"
import * as module from "module"
import * as os from "os"
import * as vscode from "vscode"
import { Commands } from "./commands"
import { CertificateError, getErrorDetail } from "./error"
import { Remote } from "./remote"
import { Storage } from "./storage"
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

  // expandPath will expand ${userHome} in the input string.
  const expandPath = (input: string): string => {
    const userHome = os.homedir()
    return input.replace(/\${userHome}/g, userHome)
  }

  // applyHttpProperties is called on extension activation and when the
  // insecure or TLS setting are changed. It updates the https agent to allow
  // self-signed certificates if the insecure setting is true, as well as
  // adding cert/key/ca properties for TLS.
  const applyHttpProperties = () => {
    const cfg = vscode.workspace.getConfiguration()
    const insecure = Boolean(cfg.get("coder.insecure"))
    const certFile = expandPath(String(cfg.get("coder.tlsCertFile") ?? "").trim())
    const keyFile = expandPath(String(cfg.get("coder.tlsKeyFile") ?? "").trim())
    const caFile = expandPath(String(cfg.get("coder.tlsCaFile") ?? "").trim())

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

  const myWorkspacesProvider = new WorkspaceProvider(WorkspaceQuery.Mine, storage, 5)
  const allWorkspacesProvider = new WorkspaceProvider(WorkspaceQuery.All, storage)

  // createTreeView, unlike registerTreeDataProvider, gives us the tree view API
  // (so we can see when it is visible) but otherwise they have the same effect.
  const wsTree = vscode.window.createTreeView("myWorkspaces", { treeDataProvider: myWorkspacesProvider })
  vscode.window.registerTreeDataProvider("allWorkspaces", allWorkspacesProvider)

  myWorkspacesProvider.setVisibility(wsTree.visible)
  wsTree.onDidChangeVisibility((event) => {
    myWorkspacesProvider.setVisibility(event.visible)
  })

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

        // We are not guaranteed that the URL we currently have is for the URL
        // this workspace belongs to, or that we even have a URL at all (the
        // queries will default to localhost) so ask for it if missing.
        // Pre-populate in case we do have the right URL so the user can just
        // hit enter and move on.
        const url = await commands.maybeAskUrl(params.get("url"), storage.getURL())
        if (url) {
          await storage.setURL(url)
        } else {
          throw new Error("url must be provided or specified as a query parameter")
        }

        // If the token is missing we will get a 401 later and the user will be
        // prompted to sign in again, so we do not need to ensure it is set.
        const token = params.get("token")
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
