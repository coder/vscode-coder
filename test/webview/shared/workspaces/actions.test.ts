import { describe, expect, it } from "vitest";

import { workspace } from "@repo/mocks";
import { workspaceActions, type WorkspaceAction } from "@repo/shared";

import type {
	Workspace,
	WorkspaceBuild,
} from "coder/site/src/api/typesGenerated";

type Overrides = Partial<Omit<Workspace, "latest_build">> & {
	latest_build?: Partial<WorkspaceBuild>;
};

const build = (
	status: WorkspaceBuild["status"],
	transition?: "start" | "stop" | "delete",
) => ({
	latest_build: { status, ...(transition ? { transition } : {}) },
});

describe("workspaceActions", () => {
	it.each<[string, Overrides, WorkspaceAction[]]>([
		["running", build("running"), ["stop", "restart", "delete"]],
		["stopped", build("stopped"), ["start", "delete"]],
		["canceled", build("canceled"), ["start", "stop", "delete"]],
		[
			"a failed start, retried by starting",
			build("failed", "start"),
			["start", "delete"],
		],
		[
			"a failed stop, retried by stopping",
			build("failed", "stop"),
			["stop", "delete"],
		],
		["a failed delete", build("failed", "delete"), ["delete"]],
		[
			"outdated",
			{ outdated: true, ...build("stopped") },
			["update", "start", "delete"],
		],
		[
			"running and forced to the active version",
			{
				outdated: true,
				template_require_active_version: true,
				...build("running"),
			},
			["update", "stop", "delete"],
		],
		[
			"stopped and updating automatically",
			{ outdated: true, automatic_updates: "always", ...build("stopped") },
			["update", "delete"],
		],
		[
			"dormant, which coder start reactivates",
			{ dormant_at: "2024-01-01T00:00:00Z", ...build("stopped") },
			["start", "delete"],
		],
		[
			"on an external agent",
			{ latest_build: { has_external_agent: true } },
			["delete"],
		],
		...(
			[
				"pending",
				"starting",
				"stopping",
				"canceling",
				"deleting",
				"deleted",
			] as const
		).map((status): [string, Overrides, WorkspaceAction[]] => [
			status,
			build(status),
			[],
		]),
	])("offers what %s allows", (_, overrides, actions) => {
		expect(workspaceActions(workspace(overrides))).toEqual(actions);
	});
});
