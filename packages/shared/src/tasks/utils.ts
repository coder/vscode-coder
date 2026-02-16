import type { Task, TaskPermissions, TaskStatus } from "./types";

export function getTaskLabel(task: Task): string {
	return task.display_name || task.name || task.id;
}

/** Whether the agent is actively working (status is active and state is working). */
export function isTaskWorking(task: Task): boolean {
	return task.status === "active" && task.current_state?.state === "working";
}

const PAUSABLE_STATUSES: readonly TaskStatus[] = [
	"active",
	"initializing",
	"pending",
	"error",
	"unknown",
];

const PAUSE_DISABLED_STATUSES: readonly TaskStatus[] = [
	"pending",
	"initializing",
];

const RESUMABLE_STATUSES: readonly TaskStatus[] = [
	"paused",
	"error",
	"unknown",
];

export function getTaskPermissions(task: Task): TaskPermissions {
	const hasWorkspace = task.workspace_id !== null;
	const status = task.status;
	const canSendMessage =
		task.status === "paused" ||
		(task.status === "active" && task.current_state?.state !== "working");
	return {
		canPause: hasWorkspace && PAUSABLE_STATUSES.includes(status),
		pauseDisabled: PAUSE_DISABLED_STATUSES.includes(status),
		canResume: hasWorkspace && RESUMABLE_STATUSES.includes(status),
		canSendMessage,
	};
}

/**
 * Task statuses where logs won't change (stable/terminal states).
 * "complete" is a TaskState (sub-state of active), checked separately.
 */
const STABLE_STATUSES: readonly TaskStatus[] = ["error", "paused"];

/** Whether a task is in a stable state where its logs won't change. */
export function isStableTask(task: Task): boolean {
	return (
		STABLE_STATUSES.includes(task.status) ||
		(task.current_state !== null && task.current_state.state !== "working")
	);
}

/** Whether the task's workspace is building (provisioner running). */
export function isBuildingWorkspace(task: Task): boolean {
	const ws = task.workspace_status;
	return ws === "pending" || ws === "starting";
}

/** Whether the workspace is running but the agent hasn't reached "ready" yet. */
export function isAgentStarting(task: Task): boolean {
	if (task.workspace_status !== "running") return false;
	const lc = task.workspace_agent_lifecycle;
	return lc === "created" || lc === "starting";
}

/** Whether the task's workspace is still starting up (building or agent initializing). */
export function isWorkspaceStarting(task: Task): boolean {
	return isBuildingWorkspace(task) || isAgentStarting(task);
}
