import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"

export function extractAgents(workspace: Workspace): WorkspaceAgent[] {
  const agents = workspace.latest_build.resources.reduce((acc, resource) => {
    return acc.concat(resource.agents || [])
  }, [] as WorkspaceAgent[])

  return agents
}
