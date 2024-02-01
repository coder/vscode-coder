import { getWorkspaces } from "coder/site/src/api/api"
import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"
import EventSource from "eventsource"
import * as path from "path"
import * as vscode from "vscode"
import { AgentMetadataEvent, AgentMetadataEventSchemaArray, extractAgents } from "./api-helper"
import { Storage } from "./storage"

export enum WorkspaceQuery {
  Mine = "owner:me",
  All = "",
}

export class WorkspaceProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private workspaces: WorkspaceTreeItem[] = []
  private agentWatchers: Record<WorkspaceAgent["id"], { dispose: () => void; metadata?: AgentMetadataEvent[] }> = {}
  private fetching = false

  constructor(
    private readonly getWorkspacesQuery: WorkspaceQuery,
    private readonly storage: Storage,
  ) {
    this.fetchAndRefresh()
  }

  // fetchAndRefresh fetches new workspaces then re-renders the entire tree.
  // Trying to call this while already refreshing is a no-op and will return
  // immediately.
  async fetchAndRefresh() {
    if (this.fetching) {
      return
    }
    this.fetching = true

    Object.values(this.agentWatchers).forEach((watcher) => watcher.dispose())

    try {
      this.workspaces = await this.fetch()
    } catch (error) {
      this.workspaces = []
    }

    this.refresh()
    this.fetching = false
  }

  /**
   * Fetch workspaces and turn them into tree items.  Throw an error if not
   * logged in or the query fails.
   */
  async fetch(): Promise<WorkspaceTreeItem[]> {
    // Assume that no URL or no token means we are not logged in.
    const url = this.storage.getURL()
    const token = await this.storage.getSessionToken()
    if (!url || !token) {
      throw new Error("not logged in")
    }

    const resp = await getWorkspaces({ q: this.getWorkspacesQuery })

    // We could have logged out while waiting for the query, or logged into a
    // different deployment.
    const url2 = this.storage.getURL()
    const token2 = await this.storage.getSessionToken()
    if (!url2 || !token2) {
      throw new Error("not logged in")
    } else if (url !== url2) {
      // In this case we need to fetch from the new deployment instead.
      // TODO: It would be better to cancel this fetch when that happens,
      // because this means we have to wait for the old fetch to finish before
      // finally getting workspaces for the new one.
      return this.fetch()
    }

    return resp.workspaces.map((workspace) => {
      const showMetadata = this.getWorkspacesQuery === WorkspaceQuery.Mine
      if (showMetadata) {
        const agents = extractAgents(workspace)
        agents.forEach((agent) => this.monitorMetadata(agent.id, url, token2)) // monitor metadata for all agents
      }
      return new WorkspaceTreeItem(workspace, this.getWorkspacesQuery === WorkspaceQuery.All, showMetadata)
    })
  }

  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
    new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>()
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event

  // refresh causes the tree to re-render.  It does not fetch fresh workspaces.
  refresh(item: vscode.TreeItem | undefined | null | void): void {
    this._onDidChangeTreeData.fire(item)
  }

  async getTreeItem(element: vscode.TreeItem): Promise<vscode.TreeItem> {
    return element
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element) {
      if (element instanceof WorkspaceTreeItem) {
        const agents = extractAgents(element.workspace)
        const agentTreeItems = agents.map(
          (agent) => new AgentTreeItem(agent, element.workspaceOwner, element.workspaceName, element.watchMetadata),
        )
        return Promise.resolve(agentTreeItems)
      } else if (element instanceof AgentTreeItem) {
        const savedMetadata = this.agentWatchers[element.agent.id]?.metadata || []
        return Promise.resolve(savedMetadata.map((metadata) => new AgentMetadataTreeItem(metadata)))
      }

      return Promise.resolve([])
    }
    return Promise.resolve(this.workspaces)
  }

  // monitorMetadata opens an SSE endpoint to monitor metadata on the specified
  // agent and registers a disposer that can be used to stop the watch.
  monitorMetadata(agentId: WorkspaceAgent["id"], url: string, token: string): void {
    const agentMetadataURL = new URL(`${url}/api/v2/workspaceagents/${agentId}/watch-metadata`)
    const agentMetadataEventSource = new EventSource(agentMetadataURL.toString(), {
      headers: {
        "Coder-Session-Token": token,
      },
    })

    this.agentWatchers[agentId] = {
      dispose: () => {
        delete this.agentWatchers[agentId]
        agentMetadataEventSource.close()
      },
    }

    agentMetadataEventSource.addEventListener("data", (event) => {
      try {
        const dataEvent = JSON.parse(event.data)
        const agentMetadata = AgentMetadataEventSchemaArray.parse(dataEvent)

        if (agentMetadata.length === 0) {
          this.agentWatchers[agentId].dispose()
        }

        const savedMetadata = this.agentWatchers[agentId].metadata
        if (JSON.stringify(savedMetadata) !== JSON.stringify(agentMetadata)) {
          this.agentWatchers[agentId].metadata = agentMetadata // overwrite existing metadata
          this.refresh()
        }
      } catch (error) {
        this.agentWatchers[agentId].dispose()
      }
    })
  }
}

type CoderTreeItemType = "coderWorkspaceSingleAgent" | "coderWorkspaceMultipleAgents" | "coderAgent"

class AgentMetadataTreeItem extends vscode.TreeItem {
  constructor(metadataEvent: AgentMetadataEvent) {
    const label =
      metadataEvent.description.display_name.trim() + ": " + metadataEvent.result.value.replace(/\n/g, "").trim()

    super(label, vscode.TreeItemCollapsibleState.None)
    const collected_at = new Date(metadataEvent.result.collected_at).toLocaleString()

    this.tooltip = "Collected at " + collected_at
    this.contextValue = "coderAgentMetadata"
  }
}

export class OpenableTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    tooltip: string,
    collapsibleState: vscode.TreeItemCollapsibleState,

    public readonly workspaceOwner: string,
    public readonly workspaceName: string,
    public readonly workspaceAgent: string | undefined,
    public readonly workspaceFolderPath: string | undefined,

    contextValue: CoderTreeItemType,
  ) {
    super(label, collapsibleState)
    this.contextValue = contextValue
    this.tooltip = tooltip
  }

  iconPath = {
    light: path.join(__filename, "..", "..", "media", "logo.svg"),
    dark: path.join(__filename, "..", "..", "media", "logo.svg"),
  }
}

class AgentTreeItem extends OpenableTreeItem {
  constructor(
    public readonly agent: WorkspaceAgent,
    workspaceOwner: string,
    workspaceName: string,
    watchMetadata = false,
  ) {
    const label = agent.name
    const detail = `Status: ${agent.status}`
    super(
      label,
      detail,
      watchMetadata ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      workspaceOwner,
      workspaceName,
      agent.name,
      agent.expanded_directory,
      "coderAgent",
    )
  }
}

export class WorkspaceTreeItem extends OpenableTreeItem {
  constructor(
    public readonly workspace: Workspace,
    public readonly showOwner: boolean,
    public readonly watchMetadata = false,
  ) {
    const status =
      workspace.latest_build.status.substring(0, 1).toUpperCase() + workspace.latest_build.status.substring(1)

    const label = showOwner ? `${workspace.owner_name} / ${workspace.name}` : workspace.name
    const detail = `Template: ${workspace.template_display_name || workspace.template_name} • Status: ${status}`
    const agents = extractAgents(workspace)
    super(
      label,
      detail,
      showOwner ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
      workspace.owner_name,
      workspace.name,
      undefined,
      agents[0]?.expanded_directory,
      agents.length > 1 ? "coderWorkspaceMultipleAgents" : "coderWorkspaceSingleAgent",
    )
  }
}
