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

/** Builds in flight, or a workspace that is gone, allow no action. */
const INACTIVE_STATUSES: ReadonlySet<WorkspaceStatus> = new Set([
	"pending",
	"starting",
	"stopping",
	"canceling",
	"deleting",
	"deleted",
]);

/** Actions allowed now, in display order, as in the dashboard's `abilitiesByWorkspaceStatus`. */
export function workspaceActions(
	workspace: Workspace,
): readonly WorkspaceAction[] {
	if (INACTIVE_STATUSES.has(workspace.latest_build.status)) {
		return [];
	}
	// `coder start` reactivates a dormant workspace before starting it.
	if (workspace.dormant_at) {
		return ["start", "delete"];
	}
	if (workspace.latest_build.has_external_agent) {
		return ["delete"];
	}
	const { status, transition } = workspace.latest_build;
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
