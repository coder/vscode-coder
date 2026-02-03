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

export function getTaskActions(task: Task): TaskActions {
	const hasWorkspace = task.workspace_id !== null;
	return {
		canPause: hasWorkspace && task.workspace_status === "running",
		canResume:
			hasWorkspace &&
			(task.workspace_status === "stopped" ||
				task.workspace_status === "failed" ||
				task.workspace_status === "canceled"),
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

	// Error takes priority
	if (task.status === "error" || taskState === "failed") {
		return "error";
	}

	// Check workspace status for paused/initializing
	if (
		task.workspace_status === "stopped" ||
		task.workspace_status === "stopping" ||
		task.workspace_status === "canceled"
	) {
		return "paused";
	}
	if (
		task.workspace_status === "starting" ||
		task.workspace_status === "pending"
	) {
		return "initializing";
	}

	// Active task states
	if (task.status === "active" && task.workspace_status === "running") {
		if (taskState === "working") return "working";
		if (taskState === "idle") return "idle";
		if (taskState === "complete") return "complete";
	}

	// Completed without running workspace
	if (taskState === "complete") return "complete";

	return "idle"; // default fallback
}
