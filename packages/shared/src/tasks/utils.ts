import type { Task, TaskPermissions, TaskStatus } from "./types";

export function getTaskLabel(task: Task): string {
	return task.display_name || task.name || task.id;
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
	return {
		canPause: hasWorkspace && PAUSABLE_STATUSES.includes(status),
		pauseDisabled: PAUSE_DISABLED_STATUSES.includes(status),
		canResume: hasWorkspace && RESUMABLE_STATUSES.includes(status),
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
