import { isAxiosError } from "axios";
import * as vscode from "vscode";

import {
	getTaskActions,
	getTaskUIState,
	type LogsStatus,
	type TaskDetails,
	type TaskTemplate,
	type TaskUIState,
} from "@repo/webview-shared";

import { type CoderApi } from "../../api/coderApi";
import { toError } from "../../error/errorUtils";
import { type Logger } from "../../logging/logger";
import { getWebviewHtml } from "../util";

import type {
	Preset,
	Task,
	TaskLogEntry,
	Template,
} from "coder/site/src/api/typesGenerated";

// =============================================================================
// IPC Message Types
// =============================================================================

/** Request from webview expecting a response */
interface IpcRequest {
	requestId: string;
	method: string;
	params?: unknown;
}

/** Response sent back to webview */
interface IpcResponse {
	requestId: string;
	method: string;
	success: boolean;
	data?: unknown;
	error?: string;
}

/** Push notification to webview (no requestId) */
interface IpcNotification {
	type: string;
	data?: unknown;
}

/** Check if message is a request (has requestId and method) */
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

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];

	// State (extension owns this)
	private tasks: Task[] = [];
	private templates: TaskTemplate[] = [];
	private tasksSupported = true;

	// Template cache
	private templatesCache: TaskTemplate[] = [];
	private templatesCacheTime = 0;
	private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

	// Log cache - stores logs per task to avoid refetching for stable states
	private logCache = new Map<
		string,
		{
			logs: TaskLogEntry[];
			status: LogsStatus;
			lastLogId: number | null;
			taskUIState: TaskUIState;
		}
	>();

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly client: CoderApi,
		private readonly logger: Logger,
		private readonly getBaseUrl: () => string | undefined,
	) {}

	public showCreateForm(): void {
		this.sendNotification({ type: "showCreateForm" });
	}

	public refresh(): void {
		this.templatesCacheTime = 0;
		this.logCache.clear();
		this.sendNotification({ type: "refresh" });
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

		// Clean up old disposables
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];

		// Set up message handling
		this.disposables.push(
			webviewView.webview.onDidReceiveMessage((message: unknown) => {
				void this.handleMessage(message);
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
		// Other messages are ignored
	}

	private async handleRequest(message: IpcRequest): Promise<void> {
		const { requestId, method, params } = message;

		try {
			const data = await this.executeMethod(method, params);
			this.sendResponse({ requestId, method, success: true, data });
		} catch (err) {
			this.logger.warn(`Request ${method} failed`, err);
			this.sendResponse({
				requestId,
				method,
				success: false,
				error: toError(err).message,
			});
		}
	}

	private async handleCommand(message: {
		method: string;
		params?: unknown;
	}): Promise<void> {
		const { method, params } = message;
		try {
			await this.executeMethod(method, params);
		} catch (err) {
			this.logger.warn(`Command ${method} failed`, err);
		}
	}

	private async executeMethod(
		method: string,
		params: unknown,
	): Promise<unknown> {
		switch (method) {
			case "init":
				await Promise.all([this.fetchTasks(), this.fetchTemplates()]);
				return {
					tasks: this.tasks,
					templates: this.templates,
					baseUrl: this.getBaseUrl() || "",
					tasksSupported: this.tasksSupported,
				};

			case "getTasks":
				await this.fetchTasks();
				return this.tasks;

			case "getTemplates":
				await this.fetchTemplates();
				return this.templates;

			case "getTask": {
				const { taskId } = params as { taskId: string };
				return await this.client.getTask("me", taskId);
			}

			case "getTaskDetails": {
				const { taskId } = params as { taskId: string };
				return await this.getTaskDetails(taskId);
			}

			case "createTask": {
				const { templateVersionId, prompt, presetId } = params as {
					templateVersionId: string;
					prompt: string;
					presetId?: string;
				};
				return await this.createTask(templateVersionId, prompt, presetId);
			}

			case "deleteTask": {
				const { taskId } = params as { taskId: string };
				await this.deleteTask(taskId);
				return;
			}

			case "pauseTask": {
				const { taskId } = params as { taskId: string };
				await this.pauseTask(taskId);
				return;
			}

			case "resumeTask": {
				const { taskId } = params as { taskId: string };
				await this.resumeTask(taskId);
				return;
			}

			case "viewInCoder": {
				const { taskId } = params as { taskId: string };
				this.viewInCoder(taskId);
				return;
			}

			case "downloadLogs": {
				const { taskId } = params as { taskId: string };
				await this.downloadLogs(taskId);
				return;
			}

			case "sendTaskMessage": {
				const { taskId, message } = params as {
					taskId: string;
					message: string;
				};
				this.sendTaskMessage(taskId, message);
				return;
			}

			case "viewLogs": {
				const { taskId } = params as { taskId: string };
				this.viewTaskLogs(taskId);
				return;
			}

			default:
				throw new Error(`Unknown method: ${method}`);
		}
	}

	private async fetchTasks(): Promise<void> {
		const baseUrl = this.getBaseUrl();
		if (!baseUrl) {
			this.tasks = [];
			return;
		}

		try {
			const tasks = await this.client.getTasks({ owner: "me" });
			this.tasks = [...tasks];
			this.tasksSupported = true;
			this.cleanupStaleCache();
		} catch (err) {
			if (isAxiosError(err) && err.response?.status === 404) {
				this.tasksSupported = false;
				this.tasks = [];
				return;
			}
			throw err;
		}
	}

	private cleanupStaleCache(): void {
		const activeTaskIds = new Set(this.tasks.map((t) => t.id));
		for (const taskId of this.logCache.keys()) {
			if (!activeTaskIds.has(taskId)) {
				this.logCache.delete(taskId);
			}
		}
	}

	private async fetchTemplates(forceRefresh = false): Promise<void> {
		const baseUrl = this.getBaseUrl();
		if (!baseUrl) {
			this.templates = [];
			return;
		}

		// Use cache if valid and not forcing refresh
		const now = Date.now();
		if (
			!forceRefresh &&
			this.templatesCache.length > 0 &&
			now - this.templatesCacheTime < this.CACHE_TTL_MS
		) {
			this.templates = this.templatesCache;
			return;
		}

		try {
			const templates = await this.client.getTemplates({});

			// Fetch presets for each template in parallel
			const templatesWithPresets = await Promise.all(
				templates.map(async (template: Template): Promise<TaskTemplate> => {
					let presets: Preset[] = [];
					try {
						const fetchedPresets = await this.client.getTemplateVersionPresets(
							template.active_version_id,
						);
						presets = fetchedPresets ?? [];
					} catch {
						// Presets may not be available for all templates
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

			this.templates = templatesWithPresets;
			this.templatesCache = templatesWithPresets;
			this.templatesCacheTime = now;
		} catch (err) {
			this.logger.warn("Failed to fetch templates", err);
			this.templates = [];
		}
	}

	private async fetchTaskLogs(
		user: string,
		taskId: string,
	): Promise<{
		logs: TaskLogEntry[];
		status: "ok" | "not_available" | "error";
	}> {
		try {
			const response = await this.client
				.getAxiosInstance()
				.get<{ logs: TaskLogEntry[] }>(`/api/v2/tasks/${user}/${taskId}/logs`);
			return { logs: response.data.logs ?? [], status: "ok" };
		} catch (err) {
			// 400 means logs not available for this task state
			if (isAxiosError(err) && err.response?.status === 400) {
				return { logs: [], status: "not_available" };
			}
			this.logger.warn("Failed to fetch task logs", err);
			return { logs: [], status: "error" };
		}
	}

	private async getTaskDetails(taskId: string): Promise<TaskDetails> {
		// Always fetch task to get current state
		const task = await this.client.getTask("me", taskId);
		const uiState = getTaskUIState(task);
		const cached = this.logCache.get(taskId);

		// Stable states where logs won't change: complete, error, paused
		const isStableState =
			uiState === "complete" || uiState === "error" || uiState === "paused";

		// Use cached logs if:
		// 1. We have a cache entry for this task
		// 2. Task is in a stable state
		// 3. Cache was captured in the same stable state (logs won't change)
		const canUseCache =
			cached && isStableState && cached.taskUIState === uiState;

		let logs: TaskLogEntry[];
		let logsStatus: LogsStatus;

		if (canUseCache) {
			logs = cached.logs;
			logsStatus = cached.status;
		} else {
			const logsResult = await this.fetchTaskLogs("me", taskId);
			logs = logsResult.logs;
			logsStatus = logsResult.status;

			// Update cache
			const lastLogId = logs.length > 0 ? logs[logs.length - 1].id : null;
			this.logCache.set(taskId, {
				logs,
				status: logsStatus,
				lastLogId,
				taskUIState: uiState,
			});
		}

		const actions = getTaskActions(task);
		return {
			task,
			logs,
			logsStatus,
			...actions,
		};
	}

	private async createTask(
		templateVersionId: string,
		prompt: string,
		presetId?: string,
	): Promise<Task> {
		const task = await this.client.createTask("me", {
			template_version_id: templateVersionId,
			template_version_preset_id: presetId,
			input: prompt,
		});

		await this.fetchTasks();
		this.sendNotification({ type: "tasksUpdated", data: this.tasks });
		void vscode.window.showInformationMessage("Task created successfully");

		return task;
	}

	private async deleteTask(taskId: string): Promise<void> {
		await this.client.deleteTask("me", taskId);
		this.logCache.delete(taskId);
		await this.fetchTasks();
		this.sendNotification({ type: "tasksUpdated", data: this.tasks });
		void vscode.window.showInformationMessage("Task deleted successfully");
	}

	private async pauseTask(taskId: string): Promise<void> {
		const task = this.tasks.find((t) => t.id === taskId);
		if (!task?.workspace_id) {
			throw new Error("Task has no workspace");
		}

		await this.client.stopWorkspace(task.workspace_id);

		await this.fetchTasks();
		this.sendNotification({ type: "tasksUpdated", data: this.tasks });
		void vscode.window.showInformationMessage("Task paused");
	}

	private async resumeTask(taskId: string): Promise<void> {
		const task = this.tasks.find((t) => t.id === taskId);
		if (!task?.workspace_id) {
			throw new Error("Task has no workspace");
		}

		await this.client.startWorkspace(
			task.workspace_id,
			task.template_version_id,
		);

		await this.fetchTasks();
		this.sendNotification({ type: "tasksUpdated", data: this.tasks });
		void vscode.window.showInformationMessage("Task resumed");
	}

	private viewInCoder(taskId: string): void {
		const baseUrl = this.getBaseUrl();
		if (!baseUrl) {
			return;
		}

		const task = this.tasks.find((t) => t.id === taskId);
		if (!task) {
			return;
		}

		const url = `${baseUrl}/tasks/${task.owner_name}/${task.id}`;
		void vscode.env.openExternal(vscode.Uri.parse(url));
	}

	private sendTaskMessage(taskId: string, message: string): void {
		this.logger.info(`Sending message to task ${taskId}: ${message}`);
		void vscode.window.showInformationMessage(
			"Follow-up messages are not yet supported by the API",
		);
	}

	private viewTaskLogs(taskId: string): void {
		const baseUrl = this.getBaseUrl();
		if (!baseUrl) {
			return;
		}

		const task = this.tasks.find((t) => t.id === taskId);
		if (!task) {
			return;
		}

		if (task.workspace_name && task.workspace_build_number) {
			const url = `${baseUrl}/@${task.owner_name}/${task.workspace_name}/builds/${task.workspace_build_number}`;
			void vscode.env.openExternal(vscode.Uri.parse(url));
		} else {
			const url = `${baseUrl}/tasks/${task.owner_name}/${task.id}`;
			void vscode.env.openExternal(vscode.Uri.parse(url));
		}
	}

	private async downloadLogs(taskId: string): Promise<void> {
		const logsResult = await this.fetchTaskLogs("me", taskId);
		if (logsResult.logs.length === 0) {
			void vscode.window.showWarningMessage("No logs available to download");
			return;
		}

		const content = logsResult.logs
			.map((log) => `[${log.time}] [${log.type}] ${log.content}`)
			.join("\n");

		const uri = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file(`task-${taskId}-logs.txt`),
			filters: { "Text files": ["txt"], "All files": ["*"] },
		});

		if (uri) {
			await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
			void vscode.window.showInformationMessage(`Logs saved to ${uri.fsPath}`);
		}
	}

	private sendResponse(response: IpcResponse): void {
		void this.view?.webview.postMessage(response);
	}

	private sendNotification(notification: IpcNotification): void {
		void this.view?.webview.postMessage(notification);
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
		this.logCache.clear();
	}
}
