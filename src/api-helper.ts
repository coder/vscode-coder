import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"

export function extractAgentsAndFolderPath(
  workspace: Workspace,
): [agents: WorkspaceAgent[], folderPath: string | undefined] {
  // TODO: multiple agent support
  const agents = workspace.latest_build.resources.reduce((acc, resource) => {
    return acc.concat(resource.agents || [])
  }, [] as WorkspaceAgent[])

  let folderPath = undefined
  if (agents.length === 1) {
    folderPath = agents[0].expanded_directory
  }
  return [agents, folderPath]
}
