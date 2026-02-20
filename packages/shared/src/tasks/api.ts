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

import type { Task, TaskDetails, TaskTemplate } from "./types";

export interface TaskIdParams {
	taskId: string;
}

export interface CreateTaskParams {
	templateVersionId: string;
	prompt: string;
	presetId?: string;
}

export interface TaskActionParams extends TaskIdParams {
	taskName: string;
}

export const TasksApi = {
	// Requests
	getTasks: defineRequest<void, readonly Task[] | null>("getTasks"),
	getTemplates: defineRequest<void, readonly TaskTemplate[] | null>(
		"getTemplates",
	),
	getTask: defineRequest<TaskIdParams, Task>("getTask"),
	getTaskDetails: defineRequest<TaskIdParams, TaskDetails>("getTaskDetails"),
	createTask: defineRequest<CreateTaskParams, Task>("createTask"),
	deleteTask: defineRequest<TaskActionParams, void>("deleteTask"),
	pauseTask: defineRequest<TaskActionParams, void>("pauseTask"),
	resumeTask: defineRequest<TaskActionParams, void>("resumeTask"),
	downloadLogs: defineRequest<TaskIdParams, void>("downloadLogs"),
	sendTaskMessage: defineRequest<TaskIdParams & { message: string }, void>(
		"sendTaskMessage",
	),
	// Commands
	viewInCoder: defineCommand<TaskIdParams>("viewInCoder"),
	viewLogs: defineCommand<TaskIdParams>("viewLogs"),
	stopStreamingWorkspaceLogs: defineCommand<void>("stopStreamingWorkspaceLogs"),
	// Notifications
	taskUpdated: defineNotification<Task>("taskUpdated"),
	tasksUpdated: defineNotification<Task[]>("tasksUpdated"),
	workspaceLogsAppend: defineNotification<string[]>("workspaceLogsAppend"),
	refresh: defineNotification<void>("refresh"),
	showCreateForm: defineNotification<void>("showCreateForm"),
} as const;
