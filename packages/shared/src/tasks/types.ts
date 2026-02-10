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
