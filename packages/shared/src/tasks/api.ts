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

const getTasks = defineRequest<void, readonly Task[] | null>("getTasks");
const getTemplates = defineRequest<void, readonly TaskTemplate[] | null>(
	"getTemplates",
);
const getTask = defineRequest<TaskIdParams, Task>("getTask");
const getTaskDetails = defineRequest<TaskIdParams, TaskDetails>(
	"getTaskDetails",
);

export interface CreateTaskParams {
	templateVersionId: string;
	prompt: string;
	presetId?: string;
}
const createTask = defineRequest<CreateTaskParams, Task>("createTask");

export interface TaskActionParams extends TaskIdParams {
	taskName: string;
}
const deleteTask = defineRequest<TaskActionParams, void>("deleteTask");
const pauseTask = defineRequest<TaskActionParams, void>("pauseTask");
const resumeTask = defineRequest<TaskActionParams, void>("resumeTask");
const downloadLogs = defineRequest<TaskIdParams, void>("downloadLogs");
const sendTaskMessage = defineRequest<TaskIdParams & { message: string }, void>(
	"sendTaskMessage",
);

const viewInCoder = defineCommand<TaskIdParams>("viewInCoder");
const viewLogs = defineCommand<TaskIdParams>("viewLogs");
const stopStreamingWorkspaceLogs = defineCommand<void>(
	"stopStreamingWorkspaceLogs",
);

const taskUpdated = defineNotification<Task>("taskUpdated");
const tasksUpdated = defineNotification<Task[]>("tasksUpdated");
const workspaceLogsAppend = defineNotification<string[]>("workspaceLogsAppend");
const refresh = defineNotification<void>("refresh");
const showCreateForm = defineNotification<void>("showCreateForm");

export const TasksApi = {
	// Requests
	getTasks,
	getTemplates,
	getTask,
	getTaskDetails,
	createTask,
	deleteTask,
	pauseTask,
	resumeTask,
	downloadLogs,
	sendTaskMessage,
	// Commands
	viewInCoder,
	viewLogs,
	stopStreamingWorkspaceLogs,
	// Notifications
	taskUpdated,
	tasksUpdated,
	workspaceLogsAppend,
	refresh,
	showCreateForm,
} as const;
