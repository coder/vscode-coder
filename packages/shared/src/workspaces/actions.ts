import type {
	Workspace,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

export type WorkspaceAction = "start" | "stop" | "restart" | "delete";

const BUSY_STATUSES: ReadonlySet<WorkspaceStatus> = new Set([
	"pending",
	"starting",
	"stopping",
	"canceling",
	"deleting",
]);

function isWorkspaceBusy(workspace: Workspace): boolean {
	return BUSY_STATUSES.has(workspace.latest_build.status);
}

/** Actions allowed now, in display order, as in the dashboard's `abilitiesByWorkspaceStatus`. */
export function workspaceActions(
	workspace: Workspace,
): readonly WorkspaceAction[] {
	if (
		isWorkspaceBusy(workspace) ||
		workspace.latest_build.status === "deleted"
	) {
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
	const actions: WorkspaceAction[] = [];
	if (status === "running") {
		actions.push("stop", "restart");
	} else if (status === "stopped") {
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
