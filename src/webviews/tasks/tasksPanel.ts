import { isAxiosError } from "axios";
import * as vscode from "vscode";

import {
	commandHandler,
	getTaskPermissions,
	getTaskLabel,
	isStableTask,
	requestHandler,
	TasksApi,
	type CreateTaskParams,
	type InitResponse,
	type IpcNotification,
	type IpcRequest,
	type IpcResponse,
	type LogsStatus,
	type TaskDetails,
	type TaskTemplate,
} from "@repo/shared";

import { type CoderApi } from "../../api/coderApi";
import { toError } from "../../error/errorUtils";
import { type Logger } from "../../logging/logger";
import { vscodeProposed } from "../../vscodeProposed";
import { getWebviewHtml } from "../util";

import type {
	Preset,
	Task,
	TaskLogEntry,
	Template,
} from "coder/site/src/api/typesGenerated";

/** Build URL to view task build logs in Coder dashboard */
function getTaskBuildUrl(baseUrl: string, task: Task): string {
	if (task.workspace_name && task.workspace_build_number) {
		return `${baseUrl}/@${task.owner_name}/${task.workspace_name}/builds/${task.workspace_build_number}`;
	}
	return `${baseUrl}/tasks/${task.owner_name}/${task.id}`;
}

/** Check if message is a request (has requestId) */
function isIpcRequest(msg: unknown): msg is IpcRequest {
	return (
		typeof msg === "object" &&
		msg !== null &&
		"requestId" in msg &&
		typeof (msg as IpcRequest).requestId === "string" &&
		"method" in msg &&
		typeof (msg as IpcRequest).method === "string"
	);
}

/** Check if message is a command (has method but no requestId) */
function isIpcCommand(
	msg: unknown,
): msg is { method: string; params?: unknown } {
	return (
		typeof msg === "object" &&
		msg !== null &&
		!("requestId" in msg) &&
		"method" in msg &&
		typeof (msg as { method: string }).method === "string"
	);
}

export class TasksPanel
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	public static readonly viewType = "coder.tasksPanel";

	private static readonly USER_ACTION_METHODS = new Set([
		TasksApi.pauseTask.method,
		TasksApi.resumeTask.method,
		TasksApi.deleteTask.method,
		TasksApi.downloadLogs.method,
	]);

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];

	// Template cache with TTL
	private templatesCache: TaskTemplate[] = [];
	private templatesCacheTime = 0;
	private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

	// Cache logs for last viewed task in stable state
	private cachedLogs?: {
		taskId: string;
		logs: TaskLogEntry[];
		status: LogsStatus;
	};

	/**
	 * Request handlers indexed by method name.
	 * Type safety is ensured at definition time via requestHandler().
	 */
	private readonly requestHandlers: Record<
		string,
		(params: unknown) => Promise<unknown>
	> = {
		[TasksApi.init.method]: requestHandler(TasksApi.init, () =>
			this.handleInit(),
		),
		[TasksApi.getTasks.method]: requestHandler(TasksApi.getTasks, async () => {
			const result = await this.fetchTasksWithStatus();
			return result.tasks;
		}),
		[TasksApi.getTemplates.method]: requestHandler(TasksApi.getTemplates, () =>
			this.fetchTemplates(),
		),
		[TasksApi.getTask.method]: requestHandler(TasksApi.getTask, (p) =>
			this.client.getTask("me", p.taskId),
		),
		[TasksApi.getTaskDetails.method]: requestHandler(
			TasksApi.getTaskDetails,
			(p) => this.handleGetTaskDetails(p.taskId),
		),
		[TasksApi.createTask.method]: requestHandler(TasksApi.createTask, (p) =>
			this.handleCreateTask(p),
		),
		[TasksApi.deleteTask.method]: requestHandler(TasksApi.deleteTask, (p) =>
			this.handleDeleteTask(p.taskId, p.taskName),
		),
		[TasksApi.pauseTask.method]: requestHandler(TasksApi.pauseTask, (p) =>
			this.handlePauseTask(p.taskId, p.taskName),
		),
		[TasksApi.resumeTask.method]: requestHandler(TasksApi.resumeTask, (p) =>
			this.handleResumeTask(p.taskId, p.taskName),
		),
		[TasksApi.downloadLogs.method]: requestHandler(TasksApi.downloadLogs, (p) =>
			this.handleDownloadLogs(p.taskId),
		),
	};

	/**
	 * Command handlers indexed by method name.
	 * Type safety is ensured at definition time via commandHandler().
	 */
	private readonly commandHandlers: Record<
		string,
		(params: unknown) => void | Promise<void>
	> = {
		[TasksApi.viewInCoder.method]: commandHandler(TasksApi.viewInCoder, (p) =>
			this.handleViewInCoder(p.taskId),
		),
		[TasksApi.viewLogs.method]: commandHandler(TasksApi.viewLogs, (p) =>
			this.handleViewLogs(p.taskId),
		),
		[TasksApi.sendTaskMessage.method]: commandHandler(
			TasksApi.sendTaskMessage,
			(p) => this.handleSendMessage(p.taskId, p.message),
		),
	};

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly client: CoderApi,
		private readonly logger: Logger,
	) {}

	public showCreateForm(): void {
		this.sendNotification({ type: TasksApi.showCreateForm.method });
	}

	public refresh(): void {
		this.templatesCacheTime = 0;
		this.cachedLogs = undefined;
		this.sendNotification({ type: TasksApi.refresh.method });
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, "dist", "webviews"),
			],
		};

		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];

		this.disposables.push(
			webviewView.webview.onDidReceiveMessage((message: unknown) => {
				this.handleMessage(message).catch((err: unknown) => {
					this.logger.error("Unhandled error in message handler", err);
				});
			}),
		);

		webviewView.webview.html = getWebviewHtml(
			webviewView.webview,
			this.extensionUri,
			"tasks",
			"Coder Tasks",
		);

		webviewView.onDidDispose(() => {
			for (const d of this.disposables) {
				d.dispose();
			}
			this.disposables = [];
		});
	}

	private async handleMessage(message: unknown): Promise<void> {
		if (isIpcRequest(message)) {
			await this.handleRequest(message);
		} else if (isIpcCommand(message)) {
			await this.handleCommand(message);
		}
	}

	private async handleRequest(message: IpcRequest): Promise<void> {
		const { requestId, method, params } = message;

		try {
			const handler = this.requestHandlers[method];
			if (!handler) {
				throw new Error(`Unknown method: ${method}`);
			}
			const data = await handler(params);
			this.sendResponse({ requestId, method, success: true, data });
		} catch (err) {
			const errorMessage = toError(err).message;
			this.logger.warn(`Request ${method} failed`, err);
			this.sendResponse({
				requestId,
				method,
				success: false,
				error: errorMessage,
			});
			if (TasksPanel.USER_ACTION_METHODS.has(method)) {
				vscode.window.showErrorMessage(errorMessage);
			}
		}
	}

	private async handleCommand(message: {
		method: string;
		params?: unknown;
	}): Promise<void> {
		const { method, params } = message;

		try {
			const handler = this.commandHandlers[method];
			if (!handler) {
				throw new Error(`Unknown command: ${method}`);
			}
			await handler(params);
		} catch (err) {
			const errorMessage = toError(err).message;
			this.logger.warn(`Command ${method} failed`, err);
			vscode.window.showErrorMessage(`Command failed: ${errorMessage}`);
		}
	}

	private async handleInit(): Promise<InitResponse> {
		const [tasksResult, templates] = await Promise.all([
			this.fetchTasksWithStatus(),
			this.fetchTemplates(),
		]);
		return {
			tasks: tasksResult.tasks,
			templates,
			baseUrl: this.client.getHost() ?? "",
			tasksSupported: tasksResult.supported,
		};
	}

	private async handleGetTaskDetails(taskId: string): Promise<TaskDetails> {
		const task = await this.client.getTask("me", taskId);
		const { logs, logsStatus } = await this.getLogsWithCache(task);
		return { task, logs, logsStatus, ...getTaskPermissions(task) };
	}

	private async handleCreateTask(params: CreateTaskParams): Promise<Task> {
		const task = await this.client.createTask("me", {
			template_version_id: params.templateVersionId,
			template_version_preset_id: params.presetId,
			input: params.prompt,
		});

		await this.refreshAndNotifyTasks();
		vscode.window.showInformationMessage(
			`Task "${getTaskLabel(task)}" created successfully`,
		);
		return task;
	}

	private async handleDeleteTask(
		taskId: string,
		taskName: string,
	): Promise<void> {
		const confirmed = await vscodeProposed.window.showWarningMessage(
			`Delete task "${taskName}"`,
			{
				modal: true,
				useCustom: true,
				detail:
					"This action is irreversible and removes all workspace resources and data.",
			},
			"Delete",
		);
		if (confirmed !== "Delete") {
			return;
		}

		await this.client.deleteTask("me", taskId);

		if (this.cachedLogs?.taskId === taskId) {
			this.cachedLogs = undefined;
		}

		await this.refreshAndNotifyTasks();
		vscode.window.showInformationMessage(
			`Task "${taskName}" deleted successfully`,
		);
	}

	private async handlePauseTask(
		taskId: string,
		taskName: string,
	): Promise<void> {
		const task = await this.client.getTask("me", taskId);
		if (!task.workspace_id) {
			throw new Error("Task has no workspace");
		}

		await this.client.stopWorkspace(task.workspace_id);

		await this.refreshAndNotifyTasks();
		vscode.window.showInformationMessage(`Task "${taskName}" paused`);
	}

	private async handleResumeTask(
		taskId: string,
		taskName: string,
	): Promise<void> {
		const task = await this.client.getTask("me", taskId);
		if (!task.workspace_id) {
			throw new Error("Task has no workspace");
		}

		await this.client.startWorkspace(
			task.workspace_id,
			task.template_version_id,
		);

		await this.refreshAndNotifyTasks();
		vscode.window.showInformationMessage(`Task "${taskName}" resumed`);
	}

	private async handleViewInCoder(taskId: string): Promise<void> {
		const baseUrl = this.client.getHost();
		if (!baseUrl) return;

		const task = await this.client.getTask("me", taskId);
		vscode.env.openExternal(
			vscode.Uri.parse(`${baseUrl}/tasks/${task.owner_name}/${task.id}`),
		);
	}

	private async handleViewLogs(taskId: string): Promise<void> {
		const baseUrl = this.client.getHost();
		if (!baseUrl) return;

		const task = await this.client.getTask("me", taskId);
		vscode.env.openExternal(vscode.Uri.parse(getTaskBuildUrl(baseUrl, task)));
	}

	private async handleDownloadLogs(taskId: string): Promise<void> {
		const result = await this.fetchTaskLogs(taskId);
		if (result.status === "error") {
			throw new Error("Failed to fetch logs for download");
		}
		if (result.logs.length === 0) {
			vscode.window.showWarningMessage("No logs available to download");
			return;
		}

		const content = result.logs
			.map((log) => `[${log.time}] [${log.type}]\n${log.content}`)
			.join("\n");

		const uri = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file(`task-${taskId}-logs.txt`),
			filters: { "Text files": ["txt"], "All files": ["*"] },
		});

		if (uri) {
			await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));

			vscode.window
				.showInformationMessage(`Logs saved to ${uri.fsPath}`, "Open File")
				.then(async (open) => {
					if (open) {
						await vscode.window.showTextDocument(uri);
					}
				});
		}
	}

	/**
	 * Placeholder handler for sending follow-up messages to a task.
	 * The Coder API does not yet support this feature.
	 */
	private handleSendMessage(taskId: string, message: string): void {
		this.logger.info(`Sending message to task ${taskId}: ${message}`);
		vscode.window.showInformationMessage(
			"Follow-up messages are not yet supported by the API",
		);
	}

	private async fetchTasksWithStatus(): Promise<{
		tasks: readonly Task[];
		supported: boolean;
	}> {
		if (!this.client.getHost()) {
			return { tasks: [], supported: true };
		}

		try {
			const tasks = await this.client.getTasks({ owner: "me" });
			return { tasks, supported: true };
		} catch (err) {
			if (isAxiosError(err) && err.response?.status === 404) {
				return { tasks: [], supported: false };
			}
			throw err;
		}
	}

	private async refreshAndNotifyTasks(): Promise<void> {
		try {
			const tasks = await this.fetchTasksWithStatus();
			this.sendNotification({
				type: TasksApi.tasksUpdated.method,
				data: tasks.tasks,
			});
		} catch (err) {
			this.logger.warn("Failed to refresh tasks after action", err);
		}
	}

	private async fetchTemplates(): Promise<TaskTemplate[]> {
		if (!this.client.getHost()) {
			return [];
		}

		const now = Date.now();
		if (
			this.templatesCache.length > 0 &&
			now - this.templatesCacheTime < this.CACHE_TTL_MS
		) {
			return this.templatesCache;
		}

		const templates = await this.client.getTemplates({});

		const result = await Promise.all(
			templates.map(async (template: Template): Promise<TaskTemplate> => {
				let presets: Preset[] = [];
				try {
					presets =
						(await this.client.getTemplateVersionPresets(
							template.active_version_id,
						)) ?? [];
				} catch {
					// Presets may not be available
				}

				return {
					id: template.id,
					name: template.name,
					displayName: template.display_name || template.name,
					icon: template.icon,
					activeVersionId: template.active_version_id,
					presets: presets.map((p) => ({
						id: p.ID,
						name: p.Name,
						isDefault: p.Default,
					})),
				};
			}),
		);

		this.templatesCache = result;
		this.templatesCacheTime = now;
		return result;
	}

	/**
	 * Get logs for a task, using cache for stable states (complete/error/paused).
	 */
	private async getLogsWithCache(
		task: Task,
	): Promise<{ logs: TaskLogEntry[]; logsStatus: LogsStatus }> {
		const stable = isStableTask(task);

		// Use cache if same task in stable state
		if (this.cachedLogs?.taskId === task.id && stable) {
			return { logs: this.cachedLogs.logs, logsStatus: this.cachedLogs.status };
		}

		const { logs, status } = await this.fetchTaskLogs(task.id);

		// Cache only for stable states
		if (stable) {
			this.cachedLogs = { taskId: task.id, logs, status };
		}

		return { logs, logsStatus: status };
	}

	private async fetchTaskLogs(
		taskId: string,
	): Promise<{ logs: TaskLogEntry[]; status: LogsStatus }> {
		try {
			const logs = await this.client.getTaskLogs("me", taskId);
			return { logs, status: "ok" };
		} catch (err) {
			if (
				isAxiosError(err) &&
				(err.response?.status === 400 || err.response?.status === 409)
			) {
				return { logs: [], status: "not_available" };
			}
			this.logger.warn("Failed to fetch task logs", err);
			return { logs: [], status: "error" };
		}
	}

	private sendResponse(response: IpcResponse): void {
		this.view?.webview.postMessage(response);
	}

	private sendNotification(notification: IpcNotification): void {
		this.view?.webview.postMessage(notification);
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
		this.cachedLogs = undefined;
	}
}
