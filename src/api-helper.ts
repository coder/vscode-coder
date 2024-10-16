import { isApiError, isApiErrorResponse } from "coder/site/src/api/errors"
import { Workspace, WorkspaceAgent } from "coder/site/src/api/typesGenerated"
import { z } from "zod"

export function errToStr(error: unknown, def: string) {
  if (error instanceof Error && error.message) {
    return error.message
  } else if (isApiError(error)) {
    return error.response.data.message
  } else if (isApiErrorResponse(error)) {
    return error.message
  } else if (typeof error === "string" && error.trim().length > 0) {
    return error
  }
  return def
}

export function extractAllAgents(workspaces: readonly Workspace[]): WorkspaceAgent[] {
  return workspaces.reduce((acc, workspace) => {
    return acc.concat(extractAgents(workspace))
  }, [] as WorkspaceAgent[])
}

export function extractAgents(workspace: Workspace): WorkspaceAgent[] {
  return workspace.latest_build.resources.reduce((acc, resource) => {
    return acc.concat(resource.agents || [])
  }, [] as WorkspaceAgent[])
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
