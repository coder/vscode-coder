"use strict"
import axios, { AxiosResponse } from "axios"
import { getAuthenticatedUser } from "coder/site/src/api/api"
import { readFileSync } from "fs"
import * as https from "https"
import * as module from "module"
import * as os from "os"
import path from "path"
import * as vscode from "vscode"
import { Commands } from "./commands"
import { SelfSignedCertificateError } from "./error"
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

  // updateInsecure is called on extension activation and when the insecure
  // setting is changed. It updates the https agent to allow self-signed
  // certificates if the insecure setting is true.
  const applyInsecure = () => {
    const insecure = Boolean(vscode.workspace.getConfiguration().get("coder.insecure"))

    axios.defaults.httpsAgent = new https.Agent({
      // rejectUnauthorized defaults to true, so we need to explicitly set it to false
      // if we want to allow self-signed certificates.
      rejectUnauthorized: !insecure,
    })
  }

  axios.interceptors.response.use(
    (r) => r,
    (err) => {
      if (err) {
        const msg = err.toString() as string
        if (msg.indexOf("unable to verify the first certificate") !== -1) {
          throw new SelfSignedCertificateError(msg)
        }
      }

      throw err
    },
  )

  vscode.workspace.onDidChangeConfiguration((e) => {
    e.affectsConfiguration("coder.insecure") && applyInsecure()
  })
  applyInsecure()

  const output = vscode.window.createOutputChannel("Coder")
  const storage = new Storage(output, ctx.globalState, ctx.secrets, ctx.globalStorageUri, ctx.logUri)
  await storage.init()

  const myWorkspacesProvider = new WorkspaceProvider(WorkspaceQuery.Mine, storage)
  const allWorkspacesProvider = new WorkspaceProvider(WorkspaceQuery.All, storage)

  vscode.window.registerTreeDataProvider("myWorkspaces", myWorkspacesProvider)
  vscode.window.registerTreeDataProvider("allWorkspaces", allWorkspacesProvider)
  await initGlobalVpnHeaders(storage)
  addAxiosInterceptor(storage)
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
    if (ex instanceof SelfSignedCertificateError) {
      const prompt = await vscodeProposed.window.showErrorMessage(
        "Failed to open workspace",
        {
          detail: SelfSignedCertificateError.Notification,
          modal: true,
          useCustom: true,
        },
        SelfSignedCertificateError.ActionAllowInsecure,
        SelfSignedCertificateError.ActionViewMoreDetails,
      )
      if (prompt === SelfSignedCertificateError.ActionAllowInsecure) {
        await ex.allowInsecure(storage)
        await remote.reloadWindow()
        return
      }
      if (prompt === SelfSignedCertificateError.ActionViewMoreDetails) {
        await ex.viewMoreDetails()
        return
      }
    }
    await vscodeProposed.window.showErrorMessage("Failed to open workspace", {
      detail: (ex as string).toString(),
      modal: true,
      useCustom: true,
    })
  }
}
function addAxiosInterceptor(storage: Storage): void {
  axios.interceptors.response.use(
    (res) => {
      if (isVpnTokenInvalid(res)) {
        getVpnHeaderFromUser(
          "seems like the Vpn Token provided is either invalid or expired, please provide a new token",
        ).then((token) => {
          storage.setVpnHeaderToken(token)
        })
      } else {
        return res
      }
    },
    (error) => {
      if (isVpnTokenInvalidOnError(error)) {
        getVpnHeaderFromUser(
          "seems like the Vpn Token provided is either invalid or expired, please provide a new token",
        ).then((token) => {
          storage.setVpnHeaderToken(token)
        })
        // vscode.window.showErrorMessage(JSON.stringify("vpn token not valid, make sure you added a correct token"))
      }
      return error
    },
  )
}
async function initGlobalVpnHeaders(storage: Storage): Promise<void> {
  //find if global vpn headers are needed
  type VpnHeaderConfig = {
    headerName: string
    token: string
    tokenFile: string
  }
  const vpnHeaderConf = vscode.workspace.getConfiguration("coder").get<VpnHeaderConfig>("vpnHeader")
  if (!vpnHeaderConf) {
    return
  }
  const { headerName, tokenFile, token } = vpnHeaderConf
  if (!headerName) {
    throw Error(
      "vpn header name was not defined in extension setting, please make sure to set `coder.vpnHeader.headerName`",
    )
  }
  const maybeVpnHeaderToken = (await storage.getVpnHeaderToken()) || token || readVpnHeaderTokenFromFile(tokenFile)
  if (maybeVpnHeaderToken) {
    storage.setVpnHeaderToken(maybeVpnHeaderToken)
    axios.defaults.headers.common[headerName] = maybeVpnHeaderToken
  } else {
    //default to read global headers from user prompt
    const vpnToken = await getVpnHeaderFromUser(
      "you need to add your vpn access token to be able to run api calls to coder ",
    )

    if (vpnToken) {
      storage.setVpnHeaderToken(vpnToken)
      axios.defaults.headers.common[headerName] = vpnToken
    } else {
      throw Error(
        "you must provide a vpn token, either by user prompt, path to file holding the token, or explicitly as conf argument ",
      )
    }
  }
}

async function getVpnHeaderFromUser(message: string): Promise<string | undefined> {
  return await vscode.window.showInputBox({
    title: "VpnToken",
    prompt: message,
    placeHolder: "put your token here",
  })
}

function readVpnHeaderTokenFromFile(filepath: string): string | undefined {
  if (!filepath) {
    return
  }
  if (filepath.startsWith("~")) {
    return readFileSync(path.join(os.homedir(), filepath.slice(1)), "utf-8")
  } else {
    return readFileSync(filepath, "utf-8")
  }
}
function isVpnTokenInvalid(res: AxiosResponse<any, any>): boolean {
  //if token expired or missing the vpn will return 200 OK with the actual html page to get you to reauthenticate
  // , this will result in "data" not being an object but a string containing the html
  return typeof res.data !== "object"
}
function isVpnTokenInvalidOnError(error: any): boolean {
  return error.isAxiosError && error.response.status === 403
}
