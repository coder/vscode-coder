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

/** Result of fetching task logs: either logs or an error/unavailable state. */
export type TaskLogs =
	| { status: "ok"; logs: readonly TaskLogEntry[] }
	| { status: "not_available" }
	| { status: "error" };

/**
 * Full details for a selected task, including logs and action availability.
 */
export interface TaskDetails extends TaskPermissions {
	task: Task;
	logs: TaskLogs;
}

export interface TaskPermissions {
	canPause: boolean;
	pauseDisabled: boolean;
	canResume: boolean;
	canSendMessage: boolean;
}
