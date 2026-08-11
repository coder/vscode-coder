import { describe, expect, it } from "vitest";
import { ZodError, type z } from "zod";

import {
	InvalidApiResponseError,
	parseApiResponse,
	SSHConfigResponseSchema,
	TemplateSchema,
	UserSchema,
	WorkspaceBuildSchema,
	WorkspaceResourcesSchema,
	WorkspaceSchema,
} from "@/api/responseValidation";

import { createMockUser } from "../../mocks/testHelpers";

const ENDPOINT = "/api/v2/users/me";
const DEPLOYMENT_URL = "https://coder.example.com";

/**
 * The smallest body each schema must keep accepting, as Coder 0.25 sends it.
 * Breaking one of these breaks old deployments; make the new field .optional().
 */
const SCHEMAS: ReadonlyArray<{
	name: string;
	schema: z.ZodType;
	minimal: unknown;
	/** The minimal body with one required field taken away. */
	incomplete: unknown;
}> = [
	{
		name: "UserSchema",
		schema: UserSchema,
		minimal: { id: "user-1", username: "dev", roles: [] },
		incomplete: { id: "user-1", username: "dev" },
	},
	{
		name: "WorkspaceSchema",
		schema: WorkspaceSchema,
		minimal: {
			id: "ws-1",
			name: "dev",
			owner_name: "developer",
			template_id: "tpl-1",
			latest_build: {
				id: "build-1",
				status: "running",
				template_version_id: "version-1",
				resources: [],
			},
		},
		incomplete: {
			id: "ws-1",
			name: "dev",
			owner_name: "developer",
			template_id: "tpl-1",
		},
	},
	{
		name: "WorkspaceBuildSchema",
		schema: WorkspaceBuildSchema,
		minimal: {
			workspace_owner_name: "developer",
			workspace_name: "dev",
			build_number: 1,
			job: { status: "succeeded" },
		},
		incomplete: {
			workspace_owner_name: "developer",
			workspace_name: "dev",
			build_number: 1,
		},
	},
	{
		name: "WorkspaceResourcesSchema",
		schema: WorkspaceResourcesSchema,
		minimal: [{}],
		incomplete: { resources: [] },
	},
	{
		name: "TemplateSchema",
		schema: TemplateSchema,
		minimal: { active_version_id: "version-1" },
		incomplete: {},
	},
	{
		name: "SSHConfigResponseSchema",
		schema: SSHConfigResponseSchema,
		minimal: { ssh_config_options: {} },
		incomplete: { hostname_prefix: "coder." },
	},
];

describe("parseApiResponse", () => {
	it("returns the body as-is, unknown fields included", () => {
		const body = { ...createMockUser(), future_field: { nested: [1, 2, 3] } };

		expect(parseApiResponse(UserSchema, body, ENDPOINT, DEPLOYMENT_URL)).toBe(
			body,
		);
	});

	it("throws InvalidApiResponseError naming the endpoint and URL", () => {
		expect(() =>
			parseApiResponse(UserSchema, {}, ENDPOINT, DEPLOYMENT_URL),
		).toThrow(
			`${DEPLOYMENT_URL} did not return a valid Coder API response for ${ENDPOINT}`,
		);
	});

	it("keeps the Zod failure as the cause", () => {
		try {
			parseApiResponse(UserSchema, {}, ENDPOINT, DEPLOYMENT_URL);
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(InvalidApiResponseError);
			expect((error as InvalidApiResponseError).cause).toBeInstanceOf(ZodError);
		}
	});

	it("names the deployment generically when no URL is known", () => {
		expect(() => parseApiResponse(UserSchema, {}, ENDPOINT)).toThrow(
			"The deployment did not return a valid Coder API response",
		);
	});

	// What a misdirected URL actually returns: a login page, an empty body,
	// or JSON from some other service.
	it.each([
		["an HTML page", "<html><body>Login</body></html>"],
		["null", null],
		["undefined", undefined],
		["an unrelated object", { message: "not found" }],
	])("rejects %s", (_name, body) => {
		expect(() => parseApiResponse(UserSchema, body, ENDPOINT)).toThrow(
			InvalidApiResponseError,
		);
	});
});

describe.each(SCHEMAS)("$name", ({ schema, minimal, incomplete }) => {
	it("accepts the minimal body an old deployment sends", () => {
		expect(schema.safeParse(minimal).success).toBe(true);
	});

	it("rejects a body missing a required field", () => {
		expect(schema.safeParse(incomplete).success).toBe(false);
	});
});

describe("WorkspaceSchema", () => {
	it("accepts resources whose agents are null or absent", () => {
		const workspace = {
			id: "ws-1",
			name: "dev",
			owner_name: "developer",
			template_id: "tpl-1",
			latest_build: {
				id: "build-1",
				status: "running",
				template_version_id: "version-1",
				resources: [{ id: "res-1", agents: null }, { id: "res-2" }],
			},
		};

		expect(WorkspaceSchema.safeParse(workspace).success).toBe(true);
	});
});
