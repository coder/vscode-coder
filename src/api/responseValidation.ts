import { z } from "zod";

import type { CoderApi } from "./coderApi";

/**
 * Thrown when a 2xx response body does not match the shape the extension
 * needs, which almost always means the URL does not point at a Coder
 * deployment (a proxy error page, a different service, a partial body).
 */
export class InvalidApiResponseError extends Error {
	constructor(
		public readonly endpoint: string,
		url: string | undefined,
		options?: { cause?: unknown },
	) {
		super(
			`${url ?? "The deployment"} did not return a valid Coder API response ` +
				`for ${endpoint}. Check that the URL points to a Coder deployment.`,
			options,
		);
		this.name = "InvalidApiResponseError";
	}
}

/**
 * Validate a response body, returning the original value with the caller's
 * type.
 *
 * Every schema passed here lists only the fields the extension reads and uses
 * looseObject so unknown fields pass through. A field may be required only if
 * every supported deployment sends it (Coder 0.25 and up, see featureSet);
 * anything newer must be .optional() with its consumers handling the absence.
 *
 * @throws {InvalidApiResponseError} naming the endpoint when validation fails.
 */
export function parseApiResponse<T>(
	schema: z.ZodType<unknown>,
	data: T,
	endpoint: string,
	url?: string,
): T {
	const result = schema.safeParse(data);
	if (!result.success) {
		throw new InvalidApiResponseError(endpoint, url, { cause: result.error });
	}
	return data;
}

export const UserSchema = z.looseObject({
	id: z.string(),
	username: z.string(),
	roles: z.array(z.looseObject({ name: z.string() })),
});

const WorkspaceAgentSchema = z.looseObject({
	id: z.string(),
	name: z.string(),
	status: z.string(),
	operating_system: z.string(),
});

const WorkspaceResourceSchema = z.looseObject({
	agents: z.array(WorkspaceAgentSchema).nullable().optional(),
});

export const WorkspaceSchema = z.looseObject({
	id: z.string(),
	name: z.string(),
	owner_name: z.string(),
	template_id: z.string(),
	latest_build: z.looseObject({
		id: z.string(),
		status: z.string(),
		template_version_id: z.string(),
		resources: z.array(WorkspaceResourceSchema),
	}),
});

/** waitForBuild reads the identifiers to poll and the job status to stop. */
export const WorkspaceBuildSchema = z.looseObject({
	workspace_owner_name: z.string(),
	workspace_name: z.string(),
	build_number: z.number(),
	job: z.looseObject({ status: z.string() }),
});

export const TemplateSchema = z.looseObject({
	active_version_id: z.string(),
});

export const WorkspaceResourcesSchema = z.array(WorkspaceResourceSchema);

export const SSHConfigResponseSchema = z.looseObject({
	ssh_config_options: z.record(z.string(), z.string()),
});

/**
 * The schema each validated SDK method's response must match, applied by
 * CoderApi. Add an entry to validate another method; the key doubles as the
 * endpoint name in the error. The OAuth endpoints are plain axios calls
 * rather than SDK methods, so they pass their schema at the call site.
 */
export const VALIDATED_RESPONSES = {
	getAuthenticatedUser: UserSchema,
	getDeploymentSSHConfig: SSHConfigResponseSchema,
	getTemplate: TemplateSchema,
	getTemplateVersionResources: WorkspaceResourcesSchema,
	getWorkspace: WorkspaceSchema,
	getWorkspaceByOwnerAndName: WorkspaceSchema,
	getWorkspaceBuildByNumber: WorkspaceBuildSchema,
	startWorkspace: WorkspaceBuildSchema,
	stopWorkspace: WorkspaceBuildSchema,
} as const satisfies Readonly<Partial<Record<keyof CoderApi, z.ZodType>>>;
