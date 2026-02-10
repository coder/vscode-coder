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
	type TaskActionParams,
} from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";

export function useTasksApi() {
	const { request, command } = useIpc();

	return {
		// Requests
		init: () => request(TasksApi.init),
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

		// Commands
		viewInCoder: (taskId: string) => command(TasksApi.viewInCoder, { taskId }),
		viewLogs: (taskId: string) => command(TasksApi.viewLogs, { taskId }),
		sendTaskMessage: (taskId: string, message: string) =>
			command(TasksApi.sendTaskMessage, { taskId, message }),
	};
}
