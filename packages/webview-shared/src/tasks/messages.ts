import type { Task, TaskDetails, TaskLogEntry, TaskTemplate } from "./types";

/**
 * Request wrapper - webview sends this to the extension.
 * Each request has a unique requestId for correlating responses.
 */
export interface TasksRequest<T = unknown> {
	requestId: string;
	type: string;
	payload?: T;
}

/**
 * Response wrapper - extension sends this back to the webview.
 * Includes the original requestId for correlation.
 */
export interface TasksResponse<T = unknown> {
	requestId: string;
	type: string;
	success: boolean;
	data?: T;
	error?: string;
}

/**
 * Requests sent from the Tasks webview to the extension.
 * These are action intents with request IDs for correlation.
 */
export type TasksWebviewRequest =
	| (TasksRequest<void> & { type: "getTasks" })
	| (TasksRequest<void> & { type: "getTemplates" })
	| (TasksRequest<{ taskId: string }> & { type: "getTaskDetails" })
	| (TasksRequest<{
			templateVersionId: string;
			prompt: string;
			presetId?: string;
	  }> & { type: "createTask" })
	| (TasksRequest<{ taskId: string }> & { type: "deleteTask" })
	| (TasksRequest<{ taskId: string }> & { type: "pauseTask" })
	| (TasksRequest<{ taskId: string }> & { type: "resumeTask" })
	| (TasksRequest<{ taskId: string }> & { type: "viewInCoder" })
	| (TasksRequest<{ taskId: string }> & { type: "downloadLogs" })
	| (TasksRequest<{ taskId: string; message: string }> & {
			type: "sendTaskMessage";
	  })
	| (TasksRequest<{ taskId: string }> & { type: "viewLogs" });

export interface TasksInitData {
	tasks: Task[];
	templates: TaskTemplate[];
	baseUrl: string;
	tasksSupported: boolean;
}

/**
 * Responses sent from the extension to the Tasks webview.
 * These correspond to the requests and include data or errors.
 */
export type TasksExtensionResponse =
	| (TasksResponse<TasksInitData> & {
			type: "init";
	  })
	| (TasksResponse<Task[]> & { type: "getTasks" })
	| (TasksResponse<TaskTemplate[]> & { type: "getTemplates" })
	| (TasksResponse<TaskDetails> & { type: "getTaskDetails" })
	| (TasksResponse<Task> & { type: "createTask" })
	| (TasksResponse<void> & {
			type:
				| "deleteTask"
				| "pauseTask"
				| "resumeTask"
				| "viewInCoder"
				| "downloadLogs"
				| "sendTaskMessage"
				| "viewLogs";
	  });

/**
 * Push messages from the extension to the webview.
 * These are server-driven events, not responses to requests.
 */
export type TasksPushMessage =
	| { type: "taskUpdated"; data: Task }
	| { type: "tasksUpdated"; data: Task[] }
	| { type: "logsAppend"; data: TaskLogEntry[] }
	| { type: "refresh" }
	| { type: "showCreateForm" };

/**
 * All messages sent from the extension to the webview.
 */
export type TasksExtensionMessage = TasksExtensionResponse | TasksPushMessage;

/**
 * Messages sent from the Tasks webview to the extension.
 */
export type TasksWebviewMessage =
	| TasksWebviewRequest
	| { type: "ready" }
	| { type: "refresh" };

/**
 * Type guard to check if a message is a request (has requestId).
 */
export function isTasksRequest(
	message: TasksWebviewMessage,
): message is TasksWebviewRequest {
	return "requestId" in message && typeof message.requestId === "string";
}

/**
 * Type guard to check if a message is a response (has requestId and success).
 */
export function isTasksResponse(
	message: TasksExtensionMessage,
): message is TasksExtensionResponse {
	return (
		"requestId" in message &&
		typeof message.requestId === "string" &&
		"success" in message
	);
}
