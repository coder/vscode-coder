import type {
	Workspace,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

export type WorkspaceAction =
	| "start"
	| "stop"
	| "restart"
	| "update"
	| "delete";

/** Statuses of a build in flight. */
export const ACTIVE_BUILD_STATUSES: ReadonlySet<WorkspaceStatus> = new Set([
	"pending",
	"starting",
	"stopping",
	"canceling",
	"deleting",
]);

/** Actions allowed now, in display order, as in the dashboard's `abilitiesByWorkspaceStatus`. */
export function workspaceActions(
	workspace: Workspace,
): readonly WorkspaceAction[] {
	const { status, transition, has_external_agent } = workspace.latest_build;
	// A build in flight, or a workspace that is gone, allows no action.
	if (ACTIVE_BUILD_STATUSES.has(status) || status === "deleted") {
		return [];
	}
	// `coder start` reactivates a dormant workspace before starting it.
	if (workspace.dormant_at) {
		return ["start", "delete"];
	}
	if (has_external_agent) {
		return ["delete"];
	}
	// A policy that forces the active version leaves only an update.
	const updateOnly =
		workspace.outdated &&
		(workspace.template_require_active_version ||
			workspace.automatic_updates === "always");
	const actions: WorkspaceAction[] = workspace.outdated ? ["update"] : [];
	if (status === "running") {
		actions.push("stop");
		if (!updateOnly) {
			actions.push("restart");
		}
	} else if (status === "stopped" && !updateOnly) {
		actions.push("start");
	} else if (status === "canceled") {
		actions.push("start", "stop");
	} else if (
		status === "failed" &&
		(transition === "start" || transition === "stop")
	) {
		actions.push(transition);
	}
	actions.push("delete");
	return actions;
}
