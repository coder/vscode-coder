import { describe, expect, it } from "vitest";

import { normalizeRoute } from "@/logging/routeNormalization";

describe("normalizeRoute", () => {
	it.each<[string | undefined, string]>([
		// Known templates collapse id and name segments.
		["/api/v2/workspaces/abc-123", "/api/v2/workspaces/{id}"],
		[
			"/api/v2/users/danny/workspace/my-workspace",
			"/api/v2/users/{name}/workspace/{name}",
		],
		["/api/v2/users/danny/keys/123", "/api/v2/users/{name}/keys/{id}"],
		["/api/v2/tasks/danny/task-123", "/api/v2/tasks/{name}/{id}"],
		[
			"/api/v2/organizations/9f0f7f37-dfb7-4f4b-bcb8-c7062c7550fc/templates/base/versions/v1",
			"/api/v2/organizations/{id}/templates/{name}/versions/{name}",
		],
		[
			"/api/v2/organizations/9f0f7f37-dfb7-4f4b-bcb8-c7062c7550fc/members/danny",
			"/api/v2/organizations/{id}/members/{name}",
		],
		[
			"/api/v2/workspaceagents/9f0f7f37-dfb7-4f4b-bcb8-c7062c7550fc/logs",
			"/api/v2/workspaceagents/{id}/logs",
		],
		[
			"/api/v2/workspaces/0196ac60-0cf9-7c6b-ba8e-925c3e83bb9f/builds/42",
			"/api/v2/workspaces/{id}/builds/{id}",
		],
		// Websocket watch routes collapse their id without a dedicated rule.
		[
			"/api/v2/workspaceagents/9f0f7f37-dfb7-4f4b-bcb8-c7062c7550fc/watch-metadata-ws",
			"/api/v2/workspaceagents/{id}/watch-metadata-ws",
		],
		[
			"/api/v2/workspaces/0196ac60-0cf9-7c6b-ba8e-925c3e83bb9f/watch-ws",
			"/api/v2/workspaces/{id}/watch-ws",
		],
		// Short static routes pass through unchanged.
		["/api/v2/buildinfo", "/api/v2/buildinfo"],
		// Query strings and fragments are dropped (they can carry tokens).
		["/api/v2/workspaces/abc-123?foo=bar", "/api/v2/workspaces/{id}"],
		[
			"/api/v2/users/danny/workspace/my-workspace?token=secret",
			"/api/v2/users/{name}/workspace/{name}",
		],
		["/api/v2/buildinfo?x=1#frag", "/api/v2/buildinfo"],
		// Short unknown routes collapse id segments without bucketing.
		["/api/v2/9f0f7f37-dfb7-4f4b-bcb8-c7062c7550fc", "/api/v2/{id}"],
		["/api/v2/12345", "/api/v2/{id}"],
		// Deep unknown routes bucket after the resource prefix, whether the
		// variable tail is an id or an unrecognizable name.
		["/api/v2/newresource/some-name/details", "/api/v2/newresource/{*}"],
		[
			"/api/v2/newresource/9f0f7f37-dfb7-4f4b-bcb8-c7062c7550fc",
			"/api/v2/newresource/{*}",
		],
		[
			"/api/v2/newresource/9f0f7f37-dfb7-4f4b-bcb8-c7062c7550fc/details",
			"/api/v2/newresource/{*}",
		],
		// Missing or unparseable input is unknown.
		[undefined, "<unknown>"],
		["", "<unknown>"],
		["http://%", "<unknown>"],
	])("normalizes %s", (url, expected) => {
		expect(normalizeRoute(url)).toBe(expected);
	});

	it("resolves relative urls against the base url", () => {
		expect(
			normalizeRoute("api/v2/workspaces/abc-123", "https://coder.example.com/"),
		).toBe("/api/v2/workspaces/{id}");
	});
});
