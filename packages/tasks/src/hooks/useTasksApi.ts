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
	createTask as createTaskDef,
	deleteTask as deleteTaskDef,
	downloadLogs as downloadLogsDef,
	getTask as getTaskDef,
	getTaskDetails as getTaskDetailsDef,
	getTasks as getTasksDef,
	getTemplates as getTemplatesDef,
	init as initDef,
	pauseTask as pauseTaskDef,
	resumeTask as resumeTaskDef,
	sendTaskMessage as sendTaskMessageDef,
	viewInCoder as viewInCoderDef,
	viewLogs as viewLogsDef,
	type CreateTaskParams,
} from "@repo/shared";
import { useIpc } from "@repo/webview-shared/react";

export function useTasksApi() {
	const { request, command } = useIpc();

	return {
		// Requests
		init: () => request(initDef),
		getTasks: () => request(getTasksDef),
		getTemplates: () => request(getTemplatesDef),
		getTask: (taskId: string) => request(getTaskDef, { taskId }),
		getTaskDetails: (taskId: string) => request(getTaskDetailsDef, { taskId }),
		createTask: (params: CreateTaskParams) => request(createTaskDef, params),
		deleteTask: (taskId: string) => request(deleteTaskDef, { taskId }),
		pauseTask: (taskId: string) => request(pauseTaskDef, { taskId }),
		resumeTask: (taskId: string) => request(resumeTaskDef, { taskId }),

		// Commands
		viewInCoder: (taskId: string) => command(viewInCoderDef, { taskId }),
		viewLogs: (taskId: string) => command(viewLogsDef, { taskId }),
		downloadLogs: (taskId: string) => command(downloadLogsDef, { taskId }),
		sendTaskMessage: (taskId: string, message: string) =>
			command(sendTaskMessageDef, { taskId, message }),
	};
}
