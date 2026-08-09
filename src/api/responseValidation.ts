import { ZodError, z } from "zod";

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
				`for ${endpoint}. Check that the URL points to a Coder deployment. ` +
				"See Output > Coder for details.",
			options,
		);
		this.name = "InvalidApiResponseError";
	}
}

/**
 * Validate a response body, returning the original value with the caller's
 * type. Schemas must use looseObject so unknown fields pass through and
 * newer deployments adding fields never break.
 *
 * @throws {InvalidApiResponseError} naming the endpoint when validation fails.
 */
export function parseApiResponse<T>(
	schema: z.ZodType<unknown>,
	data: T,
	endpoint: string,
	url?: string,
): T {
	try {
		schema.parse(data);
	} catch (error) {
		if (error instanceof ZodError) {
			throw new InvalidApiResponseError(endpoint, url, { cause: error });
		}
		throw error;
	}
	return data;
}

/**
 * Only the fields the extension reads are required; everything else passes
 * through untouched.
 */
export const UserSchema = z.looseObject({
	id: z.string(),
	username: z.string(),
	roles: z.array(z.looseObject({ name: z.string() })),
	organization_ids: z.array(z.string()),
});

const WorkspaceAgentSchema = z.looseObject({
	id: z.string(),
	name: z.string(),
	status: z.string(),
	operating_system: z.string(),
	architecture: z.string(),
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

/** waitForBuild polls `job.status`; a malformed job would loop forever. */
export const WorkspaceBuildSchema = z.looseObject({
	job: z.looseObject({ status: z.string() }),
});

export const WorkspaceResourcesSchema = z.array(WorkspaceResourceSchema);

export const SSHConfigResponseSchema = z.looseObject({
	hostname_suffix: z.string(),
	ssh_config_options: z.record(z.string(), z.string()),
});
