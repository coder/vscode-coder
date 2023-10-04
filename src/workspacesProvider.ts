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

  constructor(
    private readonly getWorkspacesQuery: WorkspaceQuery,
    private readonly storage: Storage,
  ) {
    this.fetchAndRefresh()
  }

  // fetchAndRefrehsh fetches new workspaces then re-renders the entire tree.
  async fetchAndRefresh() {
    const token = await this.storage.getSessionToken()
    const workspacesTreeItem: WorkspaceTreeItem[] = []
    Object.values(this.agentWatchers).forEach((watcher) => watcher.dispose())
    // If the URL is set then we are logged in.
    if (this.storage.getURL()) {
      const resp = await getWorkspaces({ q: this.getWorkspacesQuery })
      resp.workspaces.forEach((workspace) => {
        const showMetadata = this.getWorkspacesQuery === WorkspaceQuery.Mine
        if (showMetadata && token) {
          const agents = extractAgents(workspace)
          agents.forEach((agent) => this.monitorMetadata(agent.id, token)) // monitor metadata for all agents
        }
        const treeItem = new WorkspaceTreeItem(workspace, this.getWorkspacesQuery === WorkspaceQuery.All, showMetadata)
        workspacesTreeItem.push(treeItem)
      })
    }
    this.workspaces = workspacesTreeItem
    this.refresh()
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
  monitorMetadata(agentId: WorkspaceAgent["id"], token: string): void {
    const agentMetadataURL = new URL(`${this.storage.getURL()}/api/v2/workspaceagents/${agentId}/watch-metadata`)
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
