import * as path from "path"
import * as vscode from "vscode"
import { coderBinary, exec, mediaDir, execJSON } from "./utils"

export class CoderWorkspacesProvider implements vscode.TreeDataProvider<CoderWorkspaceListItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<CoderWorkspaceListItem | undefined | void> =
    new vscode.EventEmitter<CoderWorkspaceListItem | undefined | void>()
  readonly onDidChangeTreeData: vscode.Event<CoderWorkspaceListItem | undefined | void> =
    this._onDidChangeTreeData.event

  constructor() {
    this.refresh()
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: CoderWorkspaceListItem): vscode.TreeItem {
    return element
  }

  getChildren(): Thenable<CoderWorkspaceListItem[]> {
    return getWorkspaceItems()
  }
}

export const rebuildWorkspace = async (name: string): Promise<void> => {
  try {
    await exec(`${coderBinary} envs rebuild ${name} --force`)
    vscode.window.showInformationMessage(`Rebuilding Coder Workspace "${name}"`)
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to rebuild Coder Workspaces: ${e}`)
  }
}

export const shutdownWorkspace = async (name: string): Promise<void> => {
  try {
    await exec(`${coderBinary} envs stop ${name}`)
    vscode.window.showInformationMessage(`Shutting down Coder Workspace "${name}"`)
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to shutdown Coder Workspaces: ${e}`)
  }
}

export const openWorkspace = async (name: string): Promise<void> => {
  try {
    await exec(
      `${coderBinary} config-ssh && code --remote "ssh-remote+coder.${name}" $(${coderBinary} sh ${name} pwd | head -n 1)`,
    )
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

export const getWorkspaces = async (): Promise<CoderWorkspace[]> =>
  await execJSON<CoderWorkspace[]>(`${coderBinary} envs ls --output json`)

const getImages = (): Promise<CoderImage[]> => execJSON<CoderImage[]>(`${coderBinary} images ls --output json`)

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
  disk_gb: number
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

    const image = images.find((a) => a.id === workspace.image_id)
    if (!image) {
      throw new Error("Image does not exist")
    }
    this.description = `${image.repository}:${workspace.image_tag}, ${workspace.cpu_cores} vCPU, ${workspace.memory_gb} GB RAM`

    const icon = workspaceIcon(workspace)
    this.iconPath = {
      dark: path.join(mediaDir, "dark", icon),
      light: path.join(mediaDir, "light", icon),
    }
    this.tooltip = `${this.label}
${image.repository}:${workspace.image_tag}
${workspace.cpu_cores} vCPU
${workspace.memory_gb} GB RAM
${workspace.disk_gb} GB Disk`
  }
}

export const workspaceIcon = ({ latest_stat: { container_status } }: CoderWorkspace): string => {
  const file = {
    OFF: "off.svg",
    CREATING: "hourglass.svg",
    ERROR: "error.svg",
    ON: "on.svg",
  }[container_status]
  if (!file) {
    throw new Error(`Unknown status ${container_status}`)
  }
  return file
}
