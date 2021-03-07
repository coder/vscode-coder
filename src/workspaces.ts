import * as vscode from "vscode"
import * as path from "path"
import { exec, mediaDir, execJSON } from "./utils"

export class CoderWorkspacesProvider implements vscode.TreeDataProvider<CoderWorkspaceListItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    CoderWorkspaceListItem | undefined | void
  > = new vscode.EventEmitter<CoderWorkspaceListItem | undefined | void>()
  readonly onDidChangeTreeData: vscode.Event<CoderWorkspaceListItem | undefined | void> = this._onDidChangeTreeData
    .event

  constructor() {
    this.refresh()
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: CoderWorkspaceListItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: CoderWorkspaceListItem): Thenable<CoderWorkspaceListItem[]> {
    return getWorkspaceItems()
  }
}

export const rebuildWorkspace = async (name: string): Promise<void> => {
  try {
    await exec(`coder envs rebuild ${name} --force`)
    vscode.window.showInformationMessage(`Rebuilding Coder Workspace "${name}"`)
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to rebuild Coder Workspaces: ${e}`)
  }
}

export const shutdownWorkspace = async (name: string): Promise<void> => {
  try {
    await exec(`coder envs stop ${name}`)
    vscode.window.showInformationMessage(`Shutting down Coder Workspace "${name}"`)
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to shutdown Coder Workspaces: ${e}`)
  }
}

export const openWorkspace = async (name: string): Promise<void> => {
  try {
    await exec(`coder config-ssh && code --remote "ssh-remote+coder.${name}" $(coder sh ${name} pwd | head -n 1)`)
    vscode.window.showInformationMessage(`Opening Coder Workspace ${name}`)
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to open Coder Workspace ${name}: ${e}`)
  }
  return
}

const getWorkspaceItems = async (): Promise<CoderWorkspaceListItem[]> => {
  const images = await getImages()
  const envs = await getWorkspaces()
  envs.sort((a, b) => (a.name > b.name ? 1 : -1))
  return envs.map((w) => new CoderWorkspaceListItem(w, images, vscode.TreeItemCollapsibleState.None))
}

const getWorkspaces = async (): Promise<CoderWorkspace[]> =>
  await execJSON<CoderWorkspace[]>("coder envs ls --output json")

const getImages = (): Promise<CoderImage[]> => execJSON<CoderImage[]>(`coder images ls --output json`)

export interface CoderWorkspace {
  id: string
  name: string
  cpu_cores: number
  memory_gb: number
  updated: boolean
  image_tag: string
  image_id: string
  gpus: number
  updating: boolean
  latest_stat: {
    container_status: string
  }
}

export interface CoderImage {
  id: string
  repository: string
}

export class CoderWorkspaceListItem extends vscode.TreeItem {
  constructor(
    public readonly workspace: CoderWorkspace,
    public readonly images: CoderImage[],
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
  ) {
    super(workspace.name, collapsibleState)

    const image = images.find((a) => a.id === workspace.image_id)!
    this.description = `${image.repository}:${workspace.image_tag}, ${workspace.cpu_cores} vCPU, ${workspace.memory_gb}GB Memory`

    const icon = workspaceIcon(workspace)
    this.iconPath = {
      dark: path.join(mediaDir, "dark", icon),
      light: path.join(mediaDir, "light", icon),
    }
    this.tooltip = `${this.label}
${image.repository}:${workspace.image_tag}
${workspace.cpu_cores} vCPU
${workspace.memory_gb} GB Memory`
  }
}

const workspaceIcon = ({ latest_stat: { container_status } }: CoderWorkspace): string => {
  const file = {
    OFF: "off.svg",
    CREATING: "hourglass.svg",
    ERROR: "error.svg",
    ON: "on.svg",
  }[container_status]
  return file!
}
