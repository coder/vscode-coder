import { Api } from "coder/site/src/api/api"
import { getErrorMessage } from "coder/site/src/api/errors"
import { User, Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"
import * as vscode from "vscode"
import { makeCoderSdk, needToken } from "./api"
import { extractAgents } from "./api-helper"
import { CertificateError } from "./error"
import { Storage } from "./storage"
import { AuthorityPrefix, toSafeHost } from "./util"
import { OpenableTreeItem } from "./workspacesProvider"

export class Commands {
  // These will only be populated when actively connected to a workspace and are
  // used in commands.  Because commands can be executed by the user, it is not
  // possible to pass in arguments, so we have to store the current workspace
  // and its client somewhere, separately from the current globally logged-in
  // client, since you can connect to workspaces not belonging to whatever you
  // are logged into (for convenience; otherwise the recents menu can be a pain
  // if you use multiple deployments).
  public workspace?: Workspace
  public workspaceLogPath?: string
  public workspaceRestClient?: Api

  public constructor(
    private readonly vscodeProposed: typeof vscode,
    private readonly restClient: Api,
    private readonly storage: Storage,
  ) {}

  /**
   * Find the requested agent if specified, otherwise return the agent if there
   * is only one or ask the user to pick if there are multiple.  Return
   * undefined if the user cancels.
   */
  public async maybeAskAgent(workspace: Workspace, filter?: string): Promise<WorkspaceAgent | undefined> {
    const agents = extractAgents(workspace)
    const filteredAgents = filter ? agents.filter((agent) => agent.name === filter) : agents
    if (filteredAgents.length === 0) {
      throw new Error("Workspace has no matching agents")
    } else if (filteredAgents.length === 1) {
      return filteredAgents[0]
    } else {
      const quickPick = vscode.window.createQuickPick()
      quickPick.title = "Select an agent"
      quickPick.busy = true
      const agentItems: vscode.QuickPickItem[] = filteredAgents.map((agent) => {
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
      quickPick.items = agentItems
      quickPick.busy = false
      quickPick.show()

      const selected = await new Promise<WorkspaceAgent | undefined>((resolve) => {
        quickPick.onDidHide(() => resolve(undefined))
        quickPick.onDidChangeSelection((selected) => {
          if (selected.length < 1) {
            return resolve(undefined)
          }
          const agent = filteredAgents[quickPick.items.indexOf(selected[0])]
          resolve(agent)
        })
      })
      quickPick.dispose()
      return selected
    }
  }

  /**
   * Ask the user for the URL, letting them choose from a list of recent URLs or
   * CODER_URL or enter a new one.  Undefined means the user aborted.
   */
  private async askURL(selection?: string): Promise<string | undefined> {
    const defaultURL = vscode.workspace.getConfiguration().get<string>("coder.defaultUrl") ?? ""
    const quickPick = vscode.window.createQuickPick()
    quickPick.value = selection || defaultURL || process.env.CODER_URL || ""
    quickPick.placeholder = "https://example.coder.com"
    quickPick.title = "Enter the URL of your Coder deployment."

    // Initial items.
    quickPick.items = this.storage.withUrlHistory(defaultURL, process.env.CODER_URL).map((url) => ({
      alwaysShow: true,
      label: url,
    }))

    // Quick picks do not allow arbitrary values, so we add the value itself as
    // an option in case the user wants to connect to something that is not in
    // the list.
    quickPick.onDidChangeValue((value) => {
      quickPick.items = this.storage.withUrlHistory(defaultURL, process.env.CODER_URL, value).map((url) => ({
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
   * list of recent URLs or the default URL or CODER_URL or enter a new one, and
   * normalizes the returned URL.  Undefined means the user aborted.
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
   * ask for it first with a menu showing recent URLs along with the default URL
   * and CODER_URL, if those are set.
   */
  public async login(...args: string[]): Promise<void> {
    // Destructure would be nice but VS Code can pass undefined which errors.
    const inputUrl = args[0]
    const inputToken = args[1]
    const inputLabel = args[2]
    const isAutologin = typeof args[3] === "undefined" ? false : Boolean(args[3])

    const url = await this.maybeAskUrl(inputUrl)
    if (!url) {
      return // The user aborted.
    }

    // It is possible that we are trying to log into an old-style host, in which
    // case we want to write with the provided blank label instead of generating
    // a host label.
    const label = typeof inputLabel === "undefined" ? toSafeHost(url) : inputLabel

    // Try to get a token from the user, if we need one, and their user.
    const res = await this.maybeAskToken(url, inputToken, isAutologin)
    if (!res) {
      return // The user aborted, or unable to auth.
    }

    // The URL is good and the token is either good or not required; authorize
    // the global client.
    this.restClient.setHost(url)
    this.restClient.setSessionToken(res.token)

    // Store these to be used in later sessions.
    await this.storage.setUrl(url)
    await this.storage.setSessionToken(res.token)

    // Store on disk to be used by the cli.
    await this.storage.configureCli(label, url, res.token)

    // These contexts control various menu items and the sidebar.
    await vscode.commands.executeCommand("setContext", "coder.authenticated", true)
    if (res.user.roles.find((role) => role.name === "owner")) {
      await vscode.commands.executeCommand("setContext", "coder.isOwner", true)
    }

    vscode.window
      .showInformationMessage(
        `Welcome to Coder, ${res.user.username}!`,
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

    // Fetch workspaces for the new deployment.
    vscode.commands.executeCommand("coder.refreshWorkspaces")
  }

  /**
   * If necessary, ask for a token, and keep asking until the token has been
   * validated.  Return the token and user that was fetched to validate the
   * token.  Null means the user aborted or we were unable to authenticate with
   * mTLS (in the latter case, an error notification will have been displayed).
   */
  private async maybeAskToken(
    url: string,
    token: string,
    isAutologin: boolean,
  ): Promise<{ user: User; token: string } | null> {
    const restClient = await makeCoderSdk(url, token, this.storage)
    if (!needToken()) {
      try {
        const user = await restClient.getAuthenticatedUser()
        // For non-token auth, we write a blank token since the `vscodessh`
        // command currently always requires a token file.
        return { token: "", user }
      } catch (err) {
        const message = getErrorMessage(err, "no response from the server")
        if (isAutologin) {
          this.storage.writeToCoderOutputChannel(`Failed to log in to Coder server: ${message}`)
        } else {
          this.vscodeProposed.window.showErrorMessage("Failed to log in to Coder server", {
            detail: message,
            modal: true,
            useCustom: true,
          })
        }
        // Invalid certificate, most likely.
        return null
      }
    }

    // This prompt is for convenience; do not error if they close it since
    // they may already have a token or already have the page opened.
    await vscode.env.openExternal(vscode.Uri.parse(`${url}/cli-auth`))

    // For token auth, start with the existing token in the prompt or the last
    // used token.  Once submitted, if there is a failure we will keep asking
    // the user for a new token until they quit.
    let user: User | undefined
    const validatedToken = await vscode.window.showInputBox({
      title: "Coder API Key",
      password: true,
      placeHolder: "Paste your API key.",
      value: token || (await this.storage.getSessionToken()),
      ignoreFocusOut: true,
      validateInput: async (value) => {
        restClient.setSessionToken(value)
        try {
          user = await restClient.getAuthenticatedUser()
        } catch (err) {
          // For certificate errors show both a notification and add to the
          // text under the input box, since users sometimes miss the
          // notification.
          if (err instanceof CertificateError) {
            err.showNotification()

            return {
              message: err.x509Err || err.message,
              severity: vscode.InputBoxValidationSeverity.Error,
            }
          }
          // This could be something like the header command erroring or an
          // invalid session token.
          const message = getErrorMessage(err, "no response from the server")
          return {
            message: "Failed to authenticate: " + message,
            severity: vscode.InputBoxValidationSeverity.Error,
          }
        }
      },
    })

    if (validatedToken && user) {
      return { token: validatedToken, user }
    }

    // User aborted.
    return null
  }

  /**
   * View the logs for the currently connected workspace.
   */
  public async viewLogs(): Promise<void> {
    if (!this.workspaceLogPath) {
      vscode.window.showInformationMessage(
        "No logs available. Make sure to set coder.proxyLogDirectory to get logs.",
        this.workspaceLogPath || "<unset>",
      )
      return
    }
    const uri = vscode.Uri.file(this.workspaceLogPath)
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc)
  }

  /**
   * Log out from the currently logged-in deployment.
   */
  public async logout(): Promise<void> {
    const url = this.storage.getUrl()
    if (!url) {
      // Sanity check; command should not be available if no url.
      throw new Error("You are not logged in")
    }

    // Clear from the REST client.  An empty url will indicate to other parts of
    // the code that we are logged out.
    this.restClient.setHost("")
    this.restClient.setSessionToken("")

    // Clear from memory.
    await this.storage.setUrl(undefined)
    await this.storage.setSessionToken(undefined)

    await vscode.commands.executeCommand("setContext", "coder.authenticated", false)
    vscode.window.showInformationMessage("You've been logged out of Coder!", "Login").then((action) => {
      if (action === "Login") {
        vscode.commands.executeCommand("coder.login")
      }
    })

    // This will result in clearing the workspace list.
    vscode.commands.executeCommand("coder.refreshWorkspaces")
  }

  /**
   * Create a new workspace for the currently logged-in deployment.
   *
   * Must only be called if currently logged in.
   */
  public async createWorkspace(): Promise<void> {
    const uri = this.storage.getUrl() + "/templates"
    await vscode.commands.executeCommand("vscode.open", uri)
  }

  /**
   * Open a link to the workspace in the Coder dashboard.
   *
   * If passing in a workspace, it must belong to the currently logged-in
   * deployment.
   *
   * Otherwise, the currently connected workspace is used (if any).
   */
  public async navigateToWorkspace(workspace: OpenableTreeItem) {
    if (workspace) {
      const uri = this.storage.getUrl() + `/@${workspace.workspaceOwner}/${workspace.workspaceName}`
      await vscode.commands.executeCommand("vscode.open", uri)
    } else if (this.workspace && this.workspaceRestClient) {
      const baseUrl = this.workspaceRestClient.getAxiosInstance().defaults.baseURL
      const uri = `${baseUrl}/@${this.workspace.owner_name}/${this.workspace.name}`
      await vscode.commands.executeCommand("vscode.open", uri)
    } else {
      vscode.window.showInformationMessage("No workspace found.")
    }
  }

  /**
   * Open a link to the workspace settings in the Coder dashboard.
   *
   * If passing in a workspace, it must belong to the currently logged-in
   * deployment.
   *
   * Otherwise, the currently connected workspace is used (if any).
   */
  public async navigateToWorkspaceSettings(workspace: OpenableTreeItem) {
    if (workspace) {
      const uri = this.storage.getUrl() + `/@${workspace.workspaceOwner}/${workspace.workspaceName}/settings`
      await vscode.commands.executeCommand("vscode.open", uri)
    } else if (this.workspace && this.workspaceRestClient) {
      const baseUrl = this.workspaceRestClient.getAxiosInstance().defaults.baseURL
      const uri = `${baseUrl}/@${this.workspace.owner_name}/${this.workspace.name}/settings`
      await vscode.commands.executeCommand("vscode.open", uri)
    } else {
      vscode.window.showInformationMessage("No workspace found.")
    }
  }

  /**
   * Open a workspace or agent that is showing in the sidebar.
   *
   * This builds the host name and passes it to the VS Code Remote SSH
   * extension.

   * Throw if not logged into a deployment.
   */
  public async openFromSidebar(treeItem: OpenableTreeItem) {
    if (treeItem) {
      const baseUrl = this.restClient.getAxiosInstance().defaults.baseURL
      if (!baseUrl) {
        throw new Error("You are not logged in")
      }
      await openWorkspace(
        baseUrl,
        treeItem.workspaceOwner,
        treeItem.workspaceName,
        treeItem.workspaceAgent,
        treeItem.workspaceFolderPath,
        true,
      )
    } else {
      // If there is no tree item, then the user manually ran this command.
      // Default to the regular open instead.
      return this.open()
    }
  }

  /**
   * Open a workspace belonging to the currently logged-in deployment.
   *
   * Throw if not logged into a deployment.
   */
  public async open(...args: unknown[]): Promise<void> {
    let workspaceOwner: string
    let workspaceName: string
    let workspaceAgent: string | undefined
    let folderPath: string | undefined
    let openRecent: boolean | undefined

    const baseUrl = this.restClient.getAxiosInstance().defaults.baseURL
    if (!baseUrl) {
      throw new Error("You are not logged in")
    }

    if (args.length === 0) {
      const quickPick = vscode.window.createQuickPick()
      quickPick.value = "owner:me "
      quickPick.placeholder = "owner:me template:go"
      quickPick.title = `Connect to a workspace`
      let lastWorkspaces: readonly Workspace[]
      quickPick.onDidChangeValue((value) => {
        quickPick.busy = true
        this.restClient
          .getWorkspaces({
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
        // User declined to pick a workspace.
        return
      }
      workspaceOwner = workspace.owner_name
      workspaceName = workspace.name

      const agent = await this.maybeAskAgent(workspace)
      if (!agent) {
        // User declined to pick an agent.
        return
      }
      folderPath = agent.expanded_directory
      workspaceAgent = agent.name
    } else {
      workspaceOwner = args[0] as string
      workspaceName = args[1] as string
      // workspaceAgent is reserved for args[2], but multiple agents aren't supported yet.
      folderPath = args[3] as string | undefined
      openRecent = args[4] as boolean | undefined
    }

    await openWorkspace(baseUrl, workspaceOwner, workspaceName, workspaceAgent, folderPath, openRecent)
  }

  /**
   * Update the current workspace.  If there is no active workspace connection,
   * this is a no-op.
   */
  public async updateWorkspace(): Promise<void> {
    if (!this.workspace || !this.workspaceRestClient) {
      return
    }
    const action = await this.vscodeProposed.window.showInformationMessage(
      "Update Workspace",
      {
        useCustom: true,
        modal: true,
        detail: `Update ${this.workspace.owner_name}/${this.workspace.name} to the latest version?`,
      },
      "Update",
    )
    if (action === "Update") {
      await this.workspaceRestClient.updateWorkspaceVersion(this.workspace)
    }
  }
}

/**
 * Given a workspace, build the host name, find a directory to open, and pass
 * both to the Remote SSH plugin in the form of a remote authority URI.
 */
async function openWorkspace(
  baseUrl: string,
  workspaceOwner: string,
  workspaceName: string,
  workspaceAgent: string | undefined,
  folderPath: string | undefined,
  openRecent: boolean | undefined,
) {
  // A workspace can have multiple agents, but that's handled
  // when opening a workspace unless explicitly specified.
  let remoteAuthority = `ssh-remote+${AuthorityPrefix}.${toSafeHost(baseUrl)}--${workspaceOwner}--${workspaceName}`
  if (workspaceAgent) {
    remoteAuthority += `.${workspaceAgent}`
  }

  let newWindow = true
  // Open in the existing window if no workspaces are open.
  if (!vscode.workspace.workspaceFolders?.length) {
    newWindow = false
  }

  // If a folder isn't specified or we have been asked to open the most recent,
  // we can try to open a recently opened folder/workspace.
  if (!folderPath || openRecent) {
    const output: {
      workspaces: { folderUri: vscode.Uri; remoteAuthority: string }[]
    } = await vscode.commands.executeCommand("_workbench.getRecentlyOpened")
    const opened = output.workspaces.filter(
      // Remove recents that do not belong to this connection.  The remote
      // authority maps to a workspace or workspace/agent combination (using the
      // SSH host name).  This means, at the moment, you can have a different
      // set of recents for a workspace versus workspace/agent combination, even
      // if that agent is the default for the workspace.
      (opened) => opened.folderUri?.authority === remoteAuthority,
    )

    // openRecent will always use the most recent.  Otherwise, if there are
    // multiple we ask the user which to use.
    if (opened.length === 1 || (opened.length > 1 && openRecent)) {
      folderPath = opened[0].folderUri.path
    } else if (opened.length > 1) {
      const items = opened.map((f) => f.folderUri.path)
      folderPath = await vscode.window.showQuickPick(items, {
        title: "Select a recently opened folder",
      })
      if (!folderPath) {
        // User aborted.
        return
      }
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
