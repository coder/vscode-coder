/**
 * Tasks API - Type-safe message definitions for the Tasks webview.
 *
 * Usage:
 * ```tsx
 * const ipc = useIpc();
 * const tasks = await ipc.request(TasksApi.getTasks);  // Returns Task[]
 * ipc.command(TasksApi.viewInCoder, { taskId: "..." }); // Fire-and-forget
 * ```
 */

import {
	defineCommand,
	defineNotification,
	defineRequest,
} from "../ipc/protocol";

import type { Task, TaskDetails, TaskLogEntry, TaskTemplate } from "./types";

// =============================================================================
// Requests (expect response)
// =============================================================================

export interface InitResponse {
	tasks: Task[];
	templates: TaskTemplate[];
	baseUrl: string;
	tasksSupported: boolean;
}

export const init = defineRequest<void, InitResponse>("init");
export const getTasks = defineRequest<void, Task[]>("getTasks");
export const getTemplates = defineRequest<void, TaskTemplate[]>("getTemplates");
export const getTask = defineRequest<{ taskId: string }, Task>("getTask");
export const getTaskDetails = defineRequest<{ taskId: string }, TaskDetails>(
	"getTaskDetails",
);

export interface CreateTaskParams {
	templateVersionId: string;
	prompt: string;
	presetId?: string;
}
export const createTask = defineRequest<CreateTaskParams, Task>("createTask");

export const deleteTask = defineRequest<{ taskId: string }, void>("deleteTask");
export const pauseTask = defineRequest<{ taskId: string }, void>("pauseTask");
export const resumeTask = defineRequest<{ taskId: string }, void>("resumeTask");

// =============================================================================
// Commands (fire-and-forget)
// =============================================================================

export const viewInCoder = defineCommand<{ taskId: string }>("viewInCoder");
export const viewLogs = defineCommand<{ taskId: string }>("viewLogs");
export const downloadLogs = defineCommand<{ taskId: string }>("downloadLogs");
export const sendTaskMessage = defineCommand<{
	taskId: string;
	message: string;
}>("sendTaskMessage");

// =============================================================================
// Notifications (extension → webview push)
// =============================================================================

export const taskUpdated = defineNotification<Task>("taskUpdated");
export const tasksUpdated = defineNotification<Task[]>("tasksUpdated");
export const logsAppend = defineNotification<TaskLogEntry[]>("logsAppend");
export const refresh = defineNotification<void>("refresh");
export const showCreateForm = defineNotification<void>("showCreateForm");

// =============================================================================
// Grouped export
// =============================================================================

export const TasksApi = {
	// Requests
	init,
	getTasks,
	getTemplates,
	getTask,
	getTaskDetails,
	createTask,
	deleteTask,
	pauseTask,
	resumeTask,
	// Commands
	viewInCoder,
	viewLogs,
	downloadLogs,
	sendTaskMessage,
	// Notifications
	taskUpdated,
	tasksUpdated,
	logsAppend,
	refresh,
	showCreateForm,
} as const;
