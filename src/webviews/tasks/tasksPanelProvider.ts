import { isAxiosError } from "axios";
import stripAnsi from "strip-ansi";
import * as vscode from "vscode";

import {
	buildCommandHandlers,
	buildRequestHandlers,
	isBuildingWorkspace,
	isAgentStarting,
	getTaskPermissions,
	getTaskLabel,
	isStableTask,
	TasksApi,
	type CreateTaskParams,
	type IpcRequest,
	type IpcResponse,
	type NotificationDef,
	type TaskDetails,
	type TaskLogs,
	type TaskTemplate,
} from "@repo/shared";

import { errToStr } from "../../api/api-helper";
import { type CoderApi } from "../../api/coderApi";
import {
	LazyStream,
	streamAgentLogs,
	streamBuildLogs,
} from "../../api/workspace";
import { toError } from "../../error/errorUtils";
import { type Logger } from "../../logging/logger";
import { vscodeProposed } from "../../vscodeProposed";
import { getWebviewHtml } from "../util";

import type {
	Preset,
	ProvisionerJobLog,
	Task,
	Template,
	WorkspaceAgentLog,
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

export class TasksPanelProvider
	implements vscode.WebviewViewProvider, vscode.Disposable
{
	public static readonly viewType = "coder.tasksPanel";

	private static readonly USER_ACTION_METHODS = new Set([
		TasksApi.pauseTask.method,
		TasksApi.resumeTask.method,
		TasksApi.deleteTask.method,
		TasksApi.downloadLogs.method,
		TasksApi.sendTaskMessage.method,
	]);

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];

	// Workspace log streaming
	private readonly buildLogStream = new LazyStream<ProvisionerJobLog>();
	private readonly agentLogStream = new LazyStream<WorkspaceAgentLog[]>();
	private streamingTaskId: string | null = null;

	// Cache logs for last viewed task in stable state
	private cachedLogs?: {
		taskId: string;
		logs: TaskLogs;
	};

	private readonly requestHandlers = buildRequestHandlers(TasksApi, {
		getTasks: () => this.fetchTasks(),
		getTemplates: () => this.fetchTemplates(),
		getTask: (p) => this.client.getTask("me", p.taskId),
		getTaskDetails: (p) => this.handleGetTaskDetails(p.taskId),
		createTask: (p) => this.handleCreateTask(p),
		deleteTask: (p) => this.handleDeleteTask(p.taskId, p.taskName),
		pauseTask: (p) => this.handlePauseTask(p.taskId, p.taskName),
		resumeTask: (p) => this.handleResumeTask(p.taskId, p.taskName),
		downloadLogs: (p) => this.handleDownloadLogs(p.taskId),
		sendTaskMessage: (p) => this.handleSendMessage(p.taskId, p.message),
	});

	private readonly commandHandlers = buildCommandHandlers(TasksApi, {
		viewInCoder: (p) => this.handleViewInCoder(p.taskId),
		viewLogs: (p) => this.handleViewLogs(p.taskId),
		stopStreamingWorkspaceLogs: () => {
			this.streamingTaskId = null;
			this.buildLogStream.close();
			this.agentLogStream.close();
		},
	});

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly client: CoderApi,
		private readonly logger: Logger,
	) {}

	public showCreateForm(): void {
		this.notify(TasksApi.showCreateForm);
	}

	public refresh(): void {
		this.cachedLogs = undefined;
		this.notify(TasksApi.refresh);
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
			if (TasksPanelProvider.USER_ACTION_METHODS.has(method)) {
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

	private async handleGetTaskDetails(taskId: string): Promise<TaskDetails> {
		const task = await this.client.getTask("me", taskId);
		this.streamWorkspaceLogs(task).catch((err: unknown) => {
			this.logger.warn("Failed to stream workspace logs", err);
		});
		const logs = await this.getLogsWithCache(task);
		return { task, logs, ...getTaskPermissions(task) };
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

		await this.refreshAndNotifyTask(taskId);
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

		await this.refreshAndNotifyTask(taskId);
		vscode.window.showInformationMessage(`Task "${taskName}" resumed`);
	}

	private async handleSendMessage(
		taskId: string,
		message: string,
	): Promise<void> {
		const task = await this.client.getTask("me", taskId);

		if (task.status === "paused") {
			throw new Error("Resume the task before sending a message");
		}

		try {
			await this.client.sendTaskInput("me", taskId, message);
		} catch (err) {
			if (
				isAxiosError(err) &&
				(err.response?.status === 409 || err.response?.status === 400)
			) {
				throw new Error(
					`Task is not ready to receive messages (${errToStr(err)})`,
				);
			}
			throw err;
		}

		await this.refreshAndNotifyTask(taskId);
		vscode.window.showInformationMessage(
			`Message sent to "${getTaskLabel(task)}"`,
		);
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
		if (result.status !== "ok") {
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

	private async streamWorkspaceLogs(task: Task): Promise<void> {
		if (task.id !== this.streamingTaskId) {
			this.streamingTaskId = task.id;
			this.buildLogStream.close();
			this.agentLogStream.close();
		}

		const onOutput = (line: string) => {
			const clean = stripAnsi(line);
			// Skip lines that were purely ANSI codes, but keep intentional blank lines.
			if (line.length > 0 && clean.length === 0) return;
			this.notify(TasksApi.workspaceLogsAppend, [clean]);
		};

		const onStreamClose = () => {
			if (this.streamingTaskId !== task.id) return;
			this.refreshAndNotifyTask(task.id).catch((err: unknown) => {
				this.logger.warn("Failed to refresh task after stream close", err);
			});
		};

		if (isBuildingWorkspace(task) && task.workspace_id) {
			this.agentLogStream.close();
			const workspace = await this.client.getWorkspace(task.workspace_id);
			await this.buildLogStream.open(async () => {
				const stream = await streamBuildLogs(
					this.client,
					onOutput,
					workspace.latest_build.id,
				);
				stream.addEventListener("close", onStreamClose);
				return stream;
			});
			return;
		}

		if (isAgentStarting(task) && task.workspace_agent_id) {
			const agentId = task.workspace_agent_id;
			this.buildLogStream.close();
			await this.agentLogStream.open(async () => {
				const stream = await streamAgentLogs(this.client, onOutput, agentId);
				stream.addEventListener("close", onStreamClose);
				return stream;
			});
			return;
		}

		this.buildLogStream.close();
		this.agentLogStream.close();
	}

	private async fetchTasks(): Promise<readonly Task[] | null> {
		if (!this.client.getHost()) {
			return [];
		}

		try {
			return await this.client.getTasks({ owner: "me" });
		} catch (err) {
			if (isAxiosError(err) && err.response?.status === 404) {
				return null;
			}
			throw err;
		}
	}

	private async refreshAndNotifyTasks(): Promise<void> {
		try {
			const tasks = await this.fetchTasks();
			if (tasks !== null) {
				this.notify(TasksApi.tasksUpdated, tasks);
			}
		} catch (err) {
			this.logger.warn("Failed to refresh tasks after action", err);
		}
	}

	private async refreshAndNotifyTask(taskId: string): Promise<void> {
		try {
			const task = await this.client.getTask("me", taskId);
			this.notify(TasksApi.taskUpdated, task);
		} catch (err) {
			this.logger.warn("Failed to refresh task after action", err);
		}
	}

	private async fetchTemplates(): Promise<TaskTemplate[] | null> {
		if (!this.client.getHost()) {
			return [];
		}

		try {
			const templates = await this.client.getTemplates({});

			return await Promise.all(
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
		} catch (err) {
			if (isAxiosError(err) && err.response?.status === 404) {
				return null;
			}
			throw err;
		}
	}

	/**
	 * Get logs for a task, using cache for stable states (complete/error/paused).
	 */
	private async getLogsWithCache(task: Task): Promise<TaskLogs> {
		const stable = isStableTask(task);

		// Use cache if same task in stable state
		if (this.cachedLogs?.taskId === task.id && stable) {
			return this.cachedLogs.logs;
		}

		const logs = await this.fetchTaskLogs(task.id);

		// Cache only for stable states
		if (stable) {
			this.cachedLogs = { taskId: task.id, logs };
		}

		return logs;
	}

	private async fetchTaskLogs(taskId: string): Promise<TaskLogs> {
		try {
			const response = await this.client.getTaskLogs("me", taskId);
			return { status: "ok", logs: response.logs };
		} catch (err) {
			if (isAxiosError(err) && err.response?.status === 409) {
				return { status: "not_available" };
			}
			this.logger.warn("Failed to fetch task logs", err);
			return { status: "error" };
		}
	}

	private sendResponse(response: IpcResponse): void {
		this.view?.webview.postMessage(response);
	}

	private notify<D>(
		def: NotificationDef<D>,
		...args: D extends void ? [] : [data: D]
	): void {
		this.view?.webview.postMessage({
			type: def.method,
			...(args.length > 0 ? { data: args[0] } : {}),
		});
	}

	dispose(): void {
		this.buildLogStream.close();
		this.agentLogStream.close();
		this.streamingTaskId = null;
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
		this.cachedLogs = undefined;
	}
}
