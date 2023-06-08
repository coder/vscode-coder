import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"
import { z } from "zod"

export function extractAgents(workspace: Workspace): WorkspaceAgent[] {
  const agents = workspace.latest_build.resources.reduce((acc, resource) => {
    return acc.concat(resource.agents || [])
  }, [] as WorkspaceAgent[])

  return agents
}

export const AgentMetadataEventSchema = z.object({
  result: z.object({
    collected_at: z.string(),
    age: z.number(),
    value: z.string(),
    error: z.string(),
  }),
  description: z.object({
    display_name: z.string(),
    key: z.string(),
    script: z.string(),
    interval: z.number(),
    timeout: z.number(),
  }),
})

export const AgentMetadataEventSchemaArray = z.array(AgentMetadataEventSchema)

export type AgentMetadataEvent = z.infer<typeof AgentMetadataEventSchema>
