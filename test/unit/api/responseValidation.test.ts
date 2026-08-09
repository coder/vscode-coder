import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
	InvalidApiResponseError,
	parseApiResponse,
	SSHConfigResponseSchema,
	UserSchema,
	WorkspaceSchema,
} from "@/api/responseValidation";

const validUser = {
	id: "user-1",
	username: "developer",
	roles: [{ name: "owner", display_name: "Owner" }],
	organization_ids: ["org-1"],
	email: "dev@example.com",
	status: "active",
};

describe("parseApiResponse", () => {
	it("returns the value unchanged, preserving unknown fields", () => {
		const withExtras = { ...validUser, future_field: { nested: [1, 2, 3] } };
		const result = parseApiResponse(
			UserSchema,
			withExtras,
			"/api/v2/users/me",
			"https://coder.example.com",
		);
		expect(result).toBe(withExtras);
	});

	it("throws InvalidApiResponseError naming the endpoint and URL", () => {
		const call = () =>
			parseApiResponse(
				UserSchema,
				{ id: "user-1" },
				"/api/v2/users/me",
				"https://coder.example.com",
			);

		let caught: unknown;
		try {
			call();
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(InvalidApiResponseError);
		const error = caught as InvalidApiResponseError;
		expect(error.message).toContain(
			"https://coder.example.com did not return a valid Coder API response for /api/v2/users/me",
		);
		expect(error.cause).toBeInstanceOf(ZodError);
	});

	it("rejects a string body, e.g. an HTML proxy error page", () => {
		expect(() =>
			parseApiResponse(
				UserSchema,
				"<html><body>Login</body></html>",
				"/api/v2/users/me",
				"https://proxy.example.com",
			),
		).toThrow(InvalidApiResponseError);
	});

	it("rejects null and empty objects", () => {
		for (const body of [null, undefined, {}]) {
			expect(() =>
				parseApiResponse(UserSchema, body, "/api/v2/users/me"),
			).toThrow(InvalidApiResponseError);
		}
	});

	it("rejects a user with missing roles", () => {
		const { roles: _roles, ...noRoles } = validUser;
		expect(() =>
			parseApiResponse(UserSchema, noRoles, "/api/v2/users/me"),
		).toThrow(InvalidApiResponseError);
	});

	it("omits the URL from the message when not provided", () => {
		expect(() => parseApiResponse(UserSchema, {}, "/api/v2/users/me")).toThrow(
			"The deployment did not return a valid Coder API response",
		);
	});
});

describe("WorkspaceSchema", () => {
	const validWorkspace = {
		id: "ws-1",
		name: "dev",
		owner_name: "developer",
		template_id: "tpl-1",
		latest_build: {
			id: "build-1",
			status: "running",
			template_version_id: "version-1",
			resources: [
				{
					id: "res-1",
					agents: [
						{
							id: "agent-1",
							name: "main",
							status: "connected",
							operating_system: "linux",
							architecture: "amd64",
						},
					],
				},
			],
		},
	};

	it("accepts a workspace with agents", () => {
		expect(() =>
			parseApiResponse(
				WorkspaceSchema,
				validWorkspace,
				"/api/v2/workspaces/ws-1",
			),
		).not.toThrow();
	});

	it("accepts resources with null or missing agents", () => {
		const workspace = {
			...validWorkspace,
			latest_build: {
				...validWorkspace.latest_build,
				resources: [{ id: "res-1", agents: null }, { id: "res-2" }],
			},
		};
		expect(() =>
			parseApiResponse(WorkspaceSchema, workspace, "/api/v2/workspaces/ws-1"),
		).not.toThrow();
	});

	it("rejects a workspace without latest_build", () => {
		const { latest_build: _lb, ...noBuild } = validWorkspace;
		expect(() =>
			parseApiResponse(WorkspaceSchema, noBuild, "/api/v2/workspaces/ws-1"),
		).toThrow(InvalidApiResponseError);
	});
});

describe("SSHConfigResponseSchema", () => {
	it("accepts a valid config with extra fields", () => {
		const config = {
			hostname_prefix: "coder.",
			hostname_suffix: ".coder",
			ssh_config_options: { ConnectTimeout: "30" },
			something_new: true,
		};
		const result = parseApiResponse(
			SSHConfigResponseSchema,
			config,
			"/api/v2/deployment/ssh",
		);
		expect(result).toEqual(config);
	});

	it("rejects a config without hostname_suffix", () => {
		expect(() =>
			parseApiResponse(
				SSHConfigResponseSchema,
				{ ssh_config_options: {} },
				"/api/v2/deployment/ssh",
			),
		).toThrow(InvalidApiResponseError);
	});
});
