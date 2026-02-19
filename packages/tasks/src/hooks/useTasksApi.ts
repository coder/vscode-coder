/**
 * Tasks API hook - provides type-safe access to all Tasks operations.
 *
 * @example
 * ```tsx
 * const api = useTasksApi();
 * const tasks = await api.getTasks();
 * api.viewInCoder("task-id");
 * ```
 */

import {
	TasksApi,
	type CreateTaskParams,
	type Task,
	type TaskActionParams,
} from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";

export function useTasksApi() {
	const { request, command, onNotification } = useIpc();

	return {
		// Requests
		getTasks: () => request(TasksApi.getTasks),
		getTemplates: () => request(TasksApi.getTemplates),
		getTask: (taskId: string) => request(TasksApi.getTask, { taskId }),
		getTaskDetails: (taskId: string) =>
			request(TasksApi.getTaskDetails, { taskId }),
		createTask: (params: CreateTaskParams) =>
			request(TasksApi.createTask, params),
		deleteTask: (params: TaskActionParams) =>
			request(TasksApi.deleteTask, params),
		pauseTask: (params: TaskActionParams) =>
			request(TasksApi.pauseTask, params),
		resumeTask: (params: TaskActionParams) =>
			request(TasksApi.resumeTask, params),
		downloadLogs: (taskId: string) =>
			request(TasksApi.downloadLogs, { taskId }),
		sendTaskMessage: (taskId: string, message: string) =>
			request(TasksApi.sendTaskMessage, { taskId, message }),

		// Commands
		viewInCoder: (taskId: string) => command(TasksApi.viewInCoder, { taskId }),
		viewLogs: (taskId: string) => command(TasksApi.viewLogs, { taskId }),
		stopStreamingWorkspaceLogs: () =>
			command(TasksApi.stopStreamingWorkspaceLogs),

		// Notifications
		onTaskUpdated: (cb: (task: Task) => void) =>
			onNotification(TasksApi.taskUpdated, cb),
		onTasksUpdated: (cb: (tasks: Task[]) => void) =>
			onNotification(TasksApi.tasksUpdated, cb),
		onWorkspaceLogsAppend: (cb: (lines: string[]) => void) =>
			onNotification(TasksApi.workspaceLogsAppend, cb),
		onRefresh: (cb: () => void) => onNotification(TasksApi.refresh, cb),
		onShowCreateForm: (cb: () => void) =>
			onNotification(TasksApi.showCreateForm, cb),
	};
}
