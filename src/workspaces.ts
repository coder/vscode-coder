import * as path from "path"
import * as vscode from "vscode"
import { execCoder } from "./download"
import { mediaDir } from "./utils"

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
    await execCoder(`envs rebuild ${name} --force`)
    vscode.window.showInformationMessage(`Rebuilding Coder workspace "${name}"`)
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to rebuild Coder workspaces: ${e}`)
  }
}

export const shutdownWorkspace = async (name: string): Promise<void> => {
  try {
    await execCoder(`envs stop ${name}`)
    vscode.window.showInformationMessage(`Shutting down Coder workspace "${name}"`)
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to shutdown Coder workspaces: ${e}`)
  }
}

/**
 * Inject Coder hosts into the SSH config file.
 *
 * If `remote.SSH.configFile` is set use that otherwise use the default.
 */
const setupSSH = async (): Promise<void> => {
  const configFile = vscode.workspace.getConfiguration("remote.SSH").get("configFile")
  await execCoder(`config-ssh ${configFile ? `--filepath ${configFile}` : ""}`)
}

export const openWorkspace = async (name: string): Promise<void> => {
  try {
    await setupSSH()
    // If the provided workspace does not exist this is the point at which we
    // will find out because `coder sh` will exit with 1 causing the exec to
    // reject (piping should be avoided since the exit code is swallowed).
    const pwd = (await execCoder(`sh ${name} pwd`)).trim() || "/"
    vscode.window.showInformationMessage(`Opening Coder workspace ${name} to ${pwd}`)
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.parse(`vscode-remote://ssh-remote+coder.${name}${pwd}`),
    )
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to open Coder workspace ${name}: ${e}`)
  }
}

const getWorkspaceItems = async (): Promise<CoderWorkspaceListItem[]> => {
  const images = await getImages()
  const envs = await getWorkspaces()
  envs.sort((a, b) => (a.name > b.name ? 1 : -1))
  return envs.map((w) => new CoderWorkspaceListItem(w, images, vscode.TreeItemCollapsibleState.None))
}

export const getWorkspaces = async (): Promise<CoderWorkspace[]> => {
  return JSON.parse(await execCoder(`envs ls --output json`))
}

const getImages = async (): Promise<CoderImage[]> => {
  return JSON.parse(await execCoder(`images ls --output json`))
}

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
