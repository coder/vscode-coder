import type {
	Preset,
	Task,
	TaskLogEntry,
	TaskState,
	TaskStatus,
	Template,
} from "coder/site/src/api/typesGenerated";

// Re-export SDK types for convenience
export type { Preset, Task, TaskLogEntry, TaskState, TaskStatus, Template };

/**
 * Combined template and preset information for the create task form.
 * This is derived from Template and Preset but simplified for the webview.
 */
export interface TaskTemplate {
	id: string;
	name: string;
	displayName: string;
	icon: string;
	activeVersionId: string;
	presets: TaskPreset[];
}

export interface TaskPreset {
	id: string;
	name: string;
	isDefault: boolean;
}

/** Status of log fetching */
export type LogsStatus = "ok" | "not_available" | "error";

/**
 * Full details for a selected task, including logs and action availability.
 */
export interface TaskDetails extends TaskActions {
	task: Task;
	logs: TaskLogEntry[];
	logsStatus: LogsStatus;
}

export interface TaskActions {
	canPause: boolean;
	pauseDisabled: boolean;
	canResume: boolean;
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

export function getTaskActions(task: Task): TaskActions {
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
