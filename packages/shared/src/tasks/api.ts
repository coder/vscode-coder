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

export interface InitResponse {
	tasks: readonly Task[];
	templates: readonly TaskTemplate[];
	baseUrl: string;
	tasksSupported: boolean;
}

const init = defineRequest<void, InitResponse>("init");
const getTasks = defineRequest<void, Task[]>("getTasks");
const getTemplates = defineRequest<void, TaskTemplate[]>("getTemplates");
const getTask = defineRequest<{ taskId: string }, Task>("getTask");
const getTaskDetails = defineRequest<{ taskId: string }, TaskDetails>(
	"getTaskDetails",
);

export interface CreateTaskParams {
	templateVersionId: string;
	prompt: string;
	presetId?: string;
}
const createTask = defineRequest<CreateTaskParams, Task>("createTask");

export interface TaskActionParams {
	taskId: string;
	taskName: string;
}
const deleteTask = defineRequest<TaskActionParams, void>("deleteTask");
const pauseTask = defineRequest<TaskActionParams, void>("pauseTask");
const resumeTask = defineRequest<TaskActionParams, void>("resumeTask");
const downloadLogs = defineRequest<{ taskId: string }, void>("downloadLogs");

const viewInCoder = defineCommand<{ taskId: string }>("viewInCoder");
const viewLogs = defineCommand<{ taskId: string }>("viewLogs");
const sendTaskMessage = defineCommand<{
	taskId: string;
	message: string;
}>("sendTaskMessage");

const taskUpdated = defineNotification<Task>("taskUpdated");
const tasksUpdated = defineNotification<Task[]>("tasksUpdated");
const logsAppend = defineNotification<TaskLogEntry[]>("logsAppend");
const refresh = defineNotification<void>("refresh");
const showCreateForm = defineNotification<void>("showCreateForm");

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
	downloadLogs,
	// Commands
	viewInCoder,
	viewLogs,
	sendTaskMessage,
	// Notifications
	taskUpdated,
	tasksUpdated,
	logsAppend,
	refresh,
	showCreateForm,
} as const;
