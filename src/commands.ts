import axios from "axios"
import { getUser, getWorkspaces } from "coder/site/src/api/api"
import { Workspace } from "coder/site/src/api/typesGenerated"
import * as vscode from "vscode"
import { Storage } from "./storage"

export class Commands {
  public constructor(private readonly storage: Storage) {}

  public async login(...args: string[]): Promise<void> {
    let url: string | undefined = args.length >= 1 ? args[0] : undefined
    if (!url) {
      url = await vscode.window.showInputBox({
        title: "Coder URL",
        prompt: "Enter the URL of your Coder deployment.",
        placeHolder: "https://example.coder.com",
        value: url,
      })
    }
    if (!url) {
      return
    }

    let token: string | undefined = args.length >= 2 ? args[1] : undefined
    if (!token) {
      const opened = await vscode.env.openExternal(vscode.Uri.parse(`${url}/cli-auth`))
      if (!opened) {
        vscode.window.showWarningMessage("You must accept the URL prompt to generate an API key.")
        return
      }

      token = await vscode.window.showInputBox({
        title: "Coder API Key",
        password: true,
        placeHolder: "Copy your API key from the opened browser page.",
        value: this.storage.getSessionToken(),
        ignoreFocusOut: true,
        validateInput: (value) => {
          return axios
            .get("/api/v2/users/me", {
              baseURL: url,
              headers: {
                "Coder-Session-Token": value,
              },
            })
            .then(() => {
              return undefined
            })
            .catch((err) => {
              return {
                message: "Invalid session token! (" + err + ")",
                severity: vscode.InputBoxValidationSeverity.Error,
              }
            })
        },
      })
    }
    if (!token) {
      return
    }

    await this.storage.setURL(url)
    await this.storage.setSessionToken(token)
    const user = await getUser()
    await vscode.commands.executeCommand("setContext", "coder.authenticated", true)
    vscode.window
      .showInformationMessage(
        `Welcome to Coder, ${user.username}!`,
        {
          detail: "You can now use the Coder extension to manage your Coder instance.",
        },
        "Open Workspace",
      )
      .then((action) => {
        if (action === "Open Workspace") {
          vscode.commands.executeCommand("coder.open")
        }
      })
  }

  public async logout(): Promise<void> {
    await this.storage.setURL(undefined)
    await this.storage.setSessionToken(undefined)
    await vscode.commands.executeCommand("setContext", "coder.authenticated", false)
    vscode.window.showInformationMessage("You've been logged out of Coder!", "Login").then((action) => {
      if (action === "Login") {
        vscode.commands.executeCommand("coder.login")
      }
    })
  }

  public async open(...args: string[]): Promise<void> {
    let workspaceOwner: string
    let workspaceName: string

    if (args.length === 0) {
      const quickPick = vscode.window.createQuickPick()
      quickPick.value = "owner:me "
      quickPick.placeholder = "Filter"
      quickPick.title = "Select a workspace to connect"
      let lastWorkspaces: Workspace[]
      quickPick.onDidChangeValue((value) => {
        quickPick.busy = true
        getWorkspaces({
          q: value,
        })
          .then((workspaces) => {
            lastWorkspaces = workspaces.workspaces
            const items: vscode.QuickPickItem[] = workspaces.workspaces.map((workspace) => {
              let icon = "$(circle-filled)"
              if (workspace.latest_build.status !== "running") {
                icon = "$(circle-outline)"
              }
              const status =
                workspace.latest_build.status.substring(0, 1).toUpperCase() + workspace.latest_build.status.substring(1)
              return {
                alwaysShow: true,
                label: `${icon} ${workspace.name}`,
                detail: `Template: ${workspace.template_display_name || workspace.template_name} • Status: ${status}`,
              }
            })
            quickPick.items = items
            quickPick.busy = false
          })
          .catch(() => {
            return
          })
      })
      quickPick.show()
      const workspace = await new Promise<Workspace | undefined>((resolve) => {
        quickPick.onDidHide(() => {
          resolve(undefined)
        })
        quickPick.onDidChangeSelection((selected) => {
          if (selected.length < 1) {
            return resolve(undefined)
          }
          const workspace = lastWorkspaces[quickPick.items.indexOf(selected[0])]
          resolve(workspace)
        })
      })
      if (!workspace) {
        return
      }
      workspaceOwner = workspace.owner_name
      workspaceName = workspace.name
    } else {
      workspaceOwner = args[0]
      workspaceName = args[1]
    }

    // A workspace can have multiple agents, but that's handled
    // when opening a workspace unless explicitly specified.
    let uri = vscode.Uri.parse(`vscode-remote://coder+${workspaceOwner}.${workspaceName}/`)

    const output: {
      workspaces: { folderUri: vscode.Uri; remoteAuthority: string }[]
    } = await vscode.commands.executeCommand("_workbench.getRecentlyOpened")
    const opened = output.workspaces.filter((opened) => opened.folderUri?.authority === uri.authority)

    if (opened.length === 1) {
      uri = opened[0].folderUri
    } else if (opened.length > 0) {
      const items = opened.map((folder): vscode.QuickPickItem => {
        return {
          label: folder.folderUri.fsPath,
        }
      })
      const item = await vscode.window.showQuickPick(items, {
        title: "Select a recently opened folder",
      })
      if (!item) {
        return
      }
      const selected = opened[items.indexOf(item)]
      uri = vscode.Uri.joinPath(uri, selected.folderUri.path)
    }

    await vscode.commands.executeCommand("vscode.openFolder", uri)
  }
}
