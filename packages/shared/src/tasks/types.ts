import type {
	Preset,
	Task,
	TaskLogEntry,
	TaskState,
	TaskStatus,
	Template,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

// Re-export SDK types for convenience
export type {
	Preset,
	Task,
	TaskLogEntry,
	TaskState,
	TaskStatus,
	Template,
	WorkspaceStatus,
};

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
export interface TaskDetails {
	task: Task;
	logs: TaskLogEntry[];
	logsStatus: LogsStatus;
	canResume: boolean;
	canPause: boolean;
}

export interface TaskActions {
	canPause: boolean;
	canResume: boolean;
}

const RESUMABLE_STATUSES: readonly WorkspaceStatus[] = [
	"stopped",
	"failed",
	"canceled",
];

const PAUSED_STATUSES: readonly WorkspaceStatus[] = [
	"stopped",
	"stopping",
	"canceled",
];

const INITIALIZING_STATUSES: readonly WorkspaceStatus[] = [
	"starting",
	"pending",
];

export function getTaskActions(task: Task): TaskActions {
	const hasWorkspace = task.workspace_id !== null;
	const status = task.workspace_status;
	return {
		canPause: hasWorkspace && status === "running",
		canResume: hasWorkspace && !!status && RESUMABLE_STATUSES.includes(status),
	};
}

/** UI state derived from task status, state, and workspace status */
export type TaskUIState =
	| "working"
	| "idle"
	| "complete"
	| "error"
	| "paused"
	| "initializing";

/** Compute the UI state from a Task object */
export function getTaskUIState(task: Task): TaskUIState {
	const taskState = task.current_state?.state;
	const workspaceStatus = task.workspace_status;

	if (task.status === "error" || taskState === "failed") {
		return "error";
	}

	if (workspaceStatus && PAUSED_STATUSES.includes(workspaceStatus)) {
		return "paused";
	}

	if (workspaceStatus && INITIALIZING_STATUSES.includes(workspaceStatus)) {
		return "initializing";
	}

	if (task.status === "active" && workspaceStatus === "running" && taskState) {
		return taskState;
	}

	if (taskState === "complete") {
		return "complete";
	}

	return "idle";
}
