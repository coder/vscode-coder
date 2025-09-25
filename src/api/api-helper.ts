import { isApiError, isApiErrorResponse } from "coder/site/src/api/errors";
import {
	type Workspace,
	type WorkspaceAgent,
	type WorkspaceResource,
} from "coder/site/src/api/typesGenerated";
import { ErrorEvent } from "eventsource";
import { z } from "zod";

/**
 * Convert various error types to readable strings
 */
export function errToStr(
	error: unknown,
	def: string = "No error message provided",
) {
	if (error instanceof Error && error.message) {
		return error.message;
	} else if (isApiError(error)) {
		return error.response.data.message;
	} else if (isApiErrorResponse(error)) {
		return error.message;
	} else if (error instanceof ErrorEvent) {
		return error.code
			? `${error.code}: ${error.message || def}`
			: error.message || def;
	} else if (typeof error === "string" && error.trim().length > 0) {
		return error;
	}
	return def;
}

/**
 * Create workspace owner/name identifier
 */
export function createWorkspaceIdentifier(workspace: Workspace): string {
	return `${workspace.owner_name}/${workspace.name}`;
}

export function extractAllAgents(
	workspaces: readonly Workspace[],
): WorkspaceAgent[] {
	return workspaces.reduce((acc, workspace) => {
		return acc.concat(extractAgents(workspace.latest_build.resources));
	}, [] as WorkspaceAgent[]);
}

export function extractAgents(
	resources: readonly WorkspaceResource[],
): WorkspaceAgent[] {
	return resources.reduce((acc, resource) => {
		return acc.concat(resource.agents || []);
	}, [] as WorkspaceAgent[]);
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
});

export const AgentMetadataEventSchemaArray = z.array(AgentMetadataEventSchema);

export type AgentMetadataEvent = z.infer<typeof AgentMetadataEventSchema>;
