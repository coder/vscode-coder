/**
 * Tasks API hook - provides type-safe access to all Tasks operations.
 * Built on the generic IPC protocol for compile-time type safety.
 */

import { useCallback, useMemo } from "react";

import { useIpc } from "../ipc/useIpc";
import * as api from "../tasks/api";

import type { Task, TaskDetails, TaskTemplate } from "../tasks/types";

/**
 * Hook providing the Tasks API with full type safety.
 *
 * @example
 * ```tsx
 * const tasks = useTasksApi();
 *
 * // Requests (await response)
 * const allTasks = await tasks.getTasks();
 * const details = await tasks.getTaskDetails("task-id");
 *
 * // Commands (fire-and-forget)
 * tasks.viewInCoder("task-id");
 *
 * // Listen to notifications
 * tasks.onTasksUpdated((tasks) => setTasks(tasks));
 * ```
 */
export function useTasksApi() {
	const ipc = useIpc();

	// =========================================================================
	// Requests
	// =========================================================================

	const init = useCallback(() => ipc.request(api.init), [ipc]);

	const getTasks = useCallback(() => ipc.request(api.getTasks), [ipc]);

	const getTemplates = useCallback(() => ipc.request(api.getTemplates), [ipc]);

	const getTask = useCallback(
		(taskId: string) => ipc.request(api.getTask, { taskId }),
		[ipc],
	);

	const getTaskDetails = useCallback(
		(taskId: string) => ipc.request(api.getTaskDetails, { taskId }),
		[ipc],
	);

	const createTask = useCallback(
		(params: api.CreateTaskParams) => ipc.request(api.createTask, params),
		[ipc],
	);

	const deleteTask = useCallback(
		(taskId: string) => ipc.request(api.deleteTask, { taskId }),
		[ipc],
	);

	const pauseTask = useCallback(
		(taskId: string) => ipc.request(api.pauseTask, { taskId }),
		[ipc],
	);

	const resumeTask = useCallback(
		(taskId: string) => ipc.request(api.resumeTask, { taskId }),
		[ipc],
	);

	// =========================================================================
	// Commands (fire-and-forget)
	// =========================================================================

	const viewInCoder = useCallback(
		(taskId: string) => ipc.command(api.viewInCoder, { taskId }),
		[ipc],
	);

	const viewLogs = useCallback(
		(taskId: string) => ipc.command(api.viewLogs, { taskId }),
		[ipc],
	);

	const downloadLogs = useCallback(
		(taskId: string) => ipc.command(api.downloadLogs, { taskId }),
		[ipc],
	);

	const sendTaskMessage = useCallback(
		(taskId: string, message: string) =>
			ipc.command(api.sendTaskMessage, { taskId, message }),
		[ipc],
	);

	return useMemo(
		() => ({
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
		}),
		[
			init,
			getTasks,
			getTemplates,
			getTask,
			getTaskDetails,
			createTask,
			deleteTask,
			pauseTask,
			resumeTask,
			viewInCoder,
			viewLogs,
			downloadLogs,
			sendTaskMessage,
		],
	);
}

/** Re-export types for convenience */
export type { Task, TaskDetails, TaskTemplate };
export type { InitResponse, CreateTaskParams } from "../tasks/api";
