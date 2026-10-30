import { describe, expect, it } from "vitest";

import { workspace } from "@repo/mocks";
import { workspaceActions, type WorkspaceAction } from "@repo/shared";

import type { Workspace } from "coder/site/src/api/typesGenerated";

interface ActionsCase {
	name: string;
	workspace: Workspace;
	actions: WorkspaceAction[];
}

const outdated = (
	status: "running" | "stopped",
	policy: Partial<Workspace> = {},
) => workspace({ ...policy, outdated: true, latest_build: { status } });

describe("workspaceActions", () => {
	it.each<ActionsCase>([
		{
			name: "running",
			workspace: workspace({ latest_build: { status: "running" } }),
			actions: ["stop", "restart", "delete"],
		},
		{
			name: "stopped",
			workspace: workspace({ latest_build: { status: "stopped" } }),
			actions: ["start", "delete"],
		},
		{
			name: "canceled",
			workspace: workspace({ latest_build: { status: "canceled" } }),
			actions: ["start", "stop", "delete"],
		},
		{
			name: "a failed start, retried by starting",
			workspace: workspace({
				latest_build: { status: "failed", transition: "start" },
			}),
			actions: ["start", "delete"],
		},
		{
			name: "a failed stop, retried by stopping",
			workspace: workspace({
				latest_build: { status: "failed", transition: "stop" },
			}),
			actions: ["stop", "delete"],
		},
		{
			name: "a failed delete",
			workspace: workspace({
				latest_build: { status: "failed", transition: "delete" },
			}),
			actions: ["delete"],
		},
		{
			name: "outdated",
			workspace: outdated("stopped"),
			actions: ["update", "start", "delete"],
		},
		{
			name: "running and forced to the active version",
			workspace: outdated("running", { template_require_active_version: true }),
			actions: ["update", "stop", "delete"],
		},
		{
			name: "stopped and updating automatically",
			workspace: outdated("stopped", { automatic_updates: "always" }),
			actions: ["update", "delete"],
		},
		{
			name: "dormant, which coder start reactivates",
			workspace: workspace({
				dormant_at: "2024-01-01T00:00:00Z",
				latest_build: { status: "stopped" },
			}),
			actions: ["start", "delete"],
		},
		{
			name: "on an external agent",
			workspace: workspace({ latest_build: { has_external_agent: true } }),
			actions: ["delete"],
		},
		...(
			[
				"pending",
				"starting",
				"stopping",
				"canceling",
				"deleting",
				"deleted",
			] as const
		).map((status) => ({
			name: status,
			workspace: workspace({ latest_build: { status } }),
			actions: [],
		})),
	])("offers what $name allows", ({ workspace, actions }) => {
		expect(workspaceActions(workspace)).toEqual(actions);
	});
});
