import axios from "axios"
import { getAuthenticatedUser, getWorkspaces, updateWorkspaceVersion } from "coder/site/src/api/api"
import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"
import * as vscode from "vscode"
import { extractAgents } from "./api-helper"
import { CertificateError } from "./error"
import { Remote } from "./remote"
import { Storage } from "./storage"
import { OpenableTreeItem } from "./workspacesProvider"

export class Commands {
  public constructor(
    private readonly vscodeProposed: typeof vscode,
    private readonly storage: Storage,
  ) {}

  /**
   * Ask the user for the URL, letting them choose from a list of recent URLs or
   * CODER_URL or enter a new one.  Undefined means the user aborted.
   */
  private async askURL(selection?: string): Promise<string | undefined> {
    const quickPick = vscode.window.createQuickPick()
    quickPick.value = selection || process.env.CODER_URL || ""
    quickPick.placeholder = "https://example.coder.com"
    quickPick.title = "Enter the URL of your Coder deployment."

    // Initial items.
    quickPick.items = this.storage.withUrlHistory(process.env.CODER_URL).map((url) => ({
      alwaysShow: true,
      label: url,
    }))

    // Quick picks do not allow arbitrary values, so we add the value itself as
    // an option in case the user wants to connect to something that is not in
    // the list.
    quickPick.onDidChangeValue((value) => {
      quickPick.items = this.storage.withUrlHistory(process.env.CODER_URL, value).map((url) => ({
        alwaysShow: true,
        label: url,
      }))
    })

    quickPick.show()

    const selected = await new Promise<string | undefined>((resolve) => {
      quickPick.onDidHide(() => resolve(undefined))
      quickPick.onDidChangeSelection((selected) => resolve(selected[0]?.label))
    })
    quickPick.dispose()
    return selected
  }

  /**
   * Ask the user for the URL if it was not provided, letting them choose from a
   * list of recent URLs or CODER_URL or enter a new one, and normalizes the
   * returned URL.  Undefined means the user aborted.
   */
  public async maybeAskUrl(providedUrl: string | undefined | null, lastUsedUrl?: string): Promise<string | undefined> {
    let url = providedUrl || (await this.askURL(lastUsedUrl))
    if (!url) {
      // User aborted.
      return undefined
    }

    // Normalize URL.
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      // Default to HTTPS if not provided so URLs can be typed more easily.
      url = "https://" + url
    }
    while (url.endsWith("/")) {
      url = url.substring(0, url.length - 1)
    }
    return url
  }

  /**
   * Log into the provided deployment.  If the deployment URL is not specified,
   * ask for it first with a menu showing recent URLs and CODER_URL, if set.
   */
  public async login(...args: string[]): Promise<void> {
    const url = await this.maybeAskUrl(args[0])
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
        value: await this.storage.getSessionToken(),
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
              if (err instanceof CertificateError) {
                err.showNotification()

                return {
                  message: err.x509Err || err.message,
                  severity: vscode.InputBoxValidationSeverity.Error,
                }
              }
              // This could be something like the header command erroring or an
              // invalid session token.
              const message =
                err?.response?.data?.detail || err?.message || err?.response?.status || "no response from the server"
              return {
                message: "Failed to authenticate: " + message,
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
    try {
      const user = await getAuthenticatedUser()
      if (!user) {
        throw new Error("Failed to get authenticated user")
      }
      await vscode.commands.executeCommand("setContext", "coder.authenticated", true)
      if (user.roles.find((role) => role.name === "owner")) {
        await vscode.commands.executeCommand("setContext", "coder.isOwner", true)
      }
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
      vscode.commands.executeCommand("coder.refreshWorkspaces")
    } catch (error) {
      vscode.window.showErrorMessage("Failed to authenticate with Coder: " + error)
    }
  }

  // viewLogs opens the workspace logs.
  public async viewLogs(): Promise<void> {
    if (!this.storage.workspaceLogPath) {
      vscode.window.showInformationMessage("No logs available.", this.storage.workspaceLogPath || "<unset>")
      return
    }
    const uri = vscode.Uri.file(this.storage.workspaceLogPath)
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc)
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
    vscode.commands.executeCommand("coder.refreshWorkspaces")
  }

  public async createWorkspace(): Promise<void> {
    const uri = this.storage.getURL() + "/templates"
    await vscode.commands.executeCommand("vscode.open", uri)
  }

  public async navigateToWorkspace(workspace: OpenableTreeItem) {
    if (workspace) {
      const uri = this.storage.getURL() + `/@${workspace.workspaceOwner}/${workspace.workspaceName}`
      await vscode.commands.executeCommand("vscode.open", uri)
    } else if (this.storage.workspace) {
      const uri = this.storage.getURL() + `/@${this.storage.workspace.owner_name}/${this.storage.workspace.name}`
      await vscode.commands.executeCommand("vscode.open", uri)
    } else {
      vscode.window.showInformationMessage("No workspace found.")
    }
  }

  public async navigateToWorkspaceSettings(workspace: OpenableTreeItem) {
    if (workspace) {
      const uri = this.storage.getURL() + `/@${workspace.workspaceOwner}/${workspace.workspaceName}/settings`
      await vscode.commands.executeCommand("vscode.open", uri)
    } else if (this.storage.workspace) {
      const uri =
        this.storage.getURL() + `/@${this.storage.workspace.owner_name}/${this.storage.workspace.name}/settings`
      await vscode.commands.executeCommand("vscode.open", uri)
    } else {
      vscode.window.showInformationMessage("No workspace found.")
    }
  }

  public async openFromSidebar(treeItem: OpenableTreeItem) {
    if (treeItem) {
      await openWorkspace(
        treeItem.workspaceOwner,
        treeItem.workspaceName,
        treeItem.workspaceAgent,
        treeItem.workspaceFolderPath,
      )
    }
  }

  public async open(...args: unknown[]): Promise<void> {
    let workspaceOwner: string
    let workspaceName: string
    let workspaceAgent: string | undefined
    let folderPath: string | undefined

    if (args.length === 0) {
      const quickPick = vscode.window.createQuickPick()
      quickPick.value = "owner:me "
      quickPick.placeholder = "owner:me template:go"
      quickPick.title = `Connect to a workspace`
      let lastWorkspaces: readonly Workspace[]
      quickPick.onDidChangeValue((value) => {
        quickPick.busy = true
        getWorkspaces({
          q: value,
        })
          .then((workspaces) => {
            lastWorkspaces = workspaces.workspaces
            const items: vscode.QuickPickItem[] = workspaces.workspaces.map((workspace) => {
              let icon = "$(debug-start)"
              if (workspace.latest_build.status !== "running") {
                icon = "$(debug-stop)"
              }
              const status =
                workspace.latest_build.status.substring(0, 1).toUpperCase() + workspace.latest_build.status.substring(1)
              return {
                alwaysShow: true,
                label: `${icon} ${workspace.owner_name} / ${workspace.name}`,
                detail: `Template: ${workspace.template_display_name || workspace.template_name} • Status: ${status}`,
              }
            })
            quickPick.items = items
            quickPick.busy = false
          })
          .catch((ex) => {
            if (ex instanceof CertificateError) {
              ex.showNotification()
            }
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

      const agents = extractAgents(workspace)

      if (agents.length === 1) {
        folderPath = agents[0].expanded_directory
        workspaceAgent = agents[0].name
      } else if (agents.length > 0) {
        const agentQuickPick = vscode.window.createQuickPick()
        agentQuickPick.title = `Select an agent`

        agentQuickPick.busy = true
        const lastAgents = agents
        const agentItems: vscode.QuickPickItem[] = agents.map((agent) => {
          let icon = "$(debug-start)"
          if (agent.status !== "connected") {
            icon = "$(debug-stop)"
          }
          return {
            alwaysShow: true,
            label: `${icon} ${agent.name}`,
            detail: `${agent.name} • Status: ${agent.status}`,
          }
        })
        agentQuickPick.items = agentItems
        agentQuickPick.busy = false
        agentQuickPick.show()

        const agent = await new Promise<WorkspaceAgent | undefined>((resolve) => {
          agentQuickPick.onDidHide(() => {
            resolve(undefined)
          })
          agentQuickPick.onDidChangeSelection((selected) => {
            if (selected.length < 1) {
              return resolve(undefined)
            }
            const agent = lastAgents[agentQuickPick.items.indexOf(selected[0])]
            resolve(agent)
          })
        })

        if (agent) {
          folderPath = agent.expanded_directory
          workspaceAgent = agent.name
        } else {
          folderPath = ""
          workspaceAgent = ""
        }
      }
    } else {
      workspaceOwner = args[0] as string
      workspaceName = args[1] as string
      // workspaceAgent is reserved for args[2], but multiple agents aren't supported yet.
      folderPath = args[3] as string | undefined
    }

    await openWorkspace(workspaceOwner, workspaceName, workspaceAgent, folderPath)
  }

  public async updateWorkspace(): Promise<void> {
    if (!this.storage.workspace) {
      return
    }
    const action = await this.vscodeProposed.window.showInformationMessage(
      "Update Workspace",
      {
        useCustom: true,
        modal: true,
        detail: `${this.storage.workspace.owner_name}/${this.storage.workspace.name} will be updated then this window will reload to watch the build logs and reconnect.`,
      },
      "Update",
    )
    if (action === "Update") {
      await updateWorkspaceVersion(this.storage.workspace)
    }
  }
}

async function openWorkspace(
  workspaceOwner: string,
  workspaceName: string,
  workspaceAgent: string | undefined,
  folderPath: string | undefined,
) {
  // A workspace can have multiple agents, but that's handled
  // when opening a workspace unless explicitly specified.
  let remoteAuthority = `ssh-remote+${Remote.Prefix}${workspaceOwner}--${workspaceName}`
  if (workspaceAgent) {
    remoteAuthority += `--${workspaceAgent}`
  }

  let newWindow = true
  // Open in the existing window if no workspaces are open.
  if (!vscode.workspace.workspaceFolders?.length) {
    newWindow = false
  }

  // If a folder isn't specified, we can try to open a recently opened folder.
  if (!folderPath) {
    const output: {
      workspaces: { folderUri: vscode.Uri; remoteAuthority: string }[]
    } = await vscode.commands.executeCommand("_workbench.getRecentlyOpened")
    const opened = output.workspaces.filter(
      // Filter out `/` since that's added below.
      (opened) => opened.folderUri?.authority === remoteAuthority,
    )
    if (opened.length > 0) {
      let selected: (typeof opened)[0]

      if (opened.length > 1) {
        const items: vscode.QuickPickItem[] = opened.map((folder): vscode.QuickPickItem => {
          return {
            label: folder.folderUri.path,
          }
        })
        const item = await vscode.window.showQuickPick(items, {
          title: "Select a recently opened folder",
        })
        if (!item) {
          return
        }
        selected = opened[items.indexOf(item)]
      } else {
        selected = opened[0]
      }

      folderPath = selected.folderUri.path
    }
  }

  if (folderPath) {
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.from({
        scheme: "vscode-remote",
        authority: remoteAuthority,
        path: folderPath,
      }),
      // Open this in a new window!
      newWindow,
    )
    return
  }

  // This opens the workspace without an active folder opened.
  await vscode.commands.executeCommand("vscode.newWindow", {
    remoteAuthority: remoteAuthority,
    reuseWindow: !newWindow,
  })
}
