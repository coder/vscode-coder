import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import * as vscode from "vscode";

import { TasksPanel } from "@/webviews/tasks/tasksPanel";

import {
	TasksApi,
	defineRequest,
	type CommandDef,
	type RequestDef,
	type TaskIdParams,
} from "@repo/shared";

import {
	logEntry,
	preset,
	task,
	taskState,
	template,
} from "../../../mocks/tasks";
import {
	createAxiosError,
	createMockLogger,
	MockUserInteraction,
} from "../../../mocks/testHelpers";

import type { Task } from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";

/** Subset of CoderApi used by TasksPanel */
type TasksPanelClient = Pick<
	CoderApi,
	| "getTasks"
	| "getTask"
	| "getTaskLogs"
	| "createTask"
	| "deleteTask"
	| "getTemplates"
	| "getTemplateVersionPresets"
	| "startWorkspace"
	| "stopWorkspace"
	| "sendTaskInput"
	| "getHost"
>;

type MockClient = { [K in keyof TasksPanelClient]: Mock<TasksPanelClient[K]> };

function createClient(baseUrl = "https://coder.example.com"): MockClient {
	return {
		getTasks: vi.fn().mockResolvedValue([]),
		getTask: vi.fn(),
		getTaskLogs: vi.fn().mockResolvedValue({ logs: [] }),
		createTask: vi.fn(),
		deleteTask: vi.fn().mockResolvedValue(undefined),
		getTemplates: vi.fn().mockResolvedValue([]),
		getTemplateVersionPresets: vi.fn().mockResolvedValue([]),
		startWorkspace: vi.fn().mockResolvedValue(undefined),
		stopWorkspace: vi.fn().mockResolvedValue(undefined),
		sendTaskInput: vi.fn().mockResolvedValue(undefined),
		getHost: vi.fn().mockReturnValue(baseUrl),
	} as MockClient;
}

interface Harness {
	panel: TasksPanel;
	client: MockClient;
	ui: MockUserInteraction;
	/** Send a request and wait for the response */
	request: <P, R>(
		def: RequestDef<P, R>,
		...args: P extends void ? [] : [params: P]
	) => Promise<{ success: boolean; data?: R; error?: string }>;
	/** Send a fire-and-forget command */
	command: <P>(
		def: CommandDef<P>,
		...args: P extends void ? [] : [params: P]
	) => Promise<void>;
	messages: () => unknown[];
}

function createHarness(): Harness {
	const ui = new MockUserInteraction();
	const client = createClient();
	const panel = new TasksPanel(
		vscode.Uri.file("/test/extension"),
		// Cast needed: mock only implements the subset of CoderApi methods used by TasksPanel
		client as unknown as CoderApi,
		createMockLogger(),
	);

	const posted: unknown[] = [];
	let handler: ((msg: unknown) => void) | null = null;

	const webview: vscode.WebviewView = {
		viewType: "coder.tasksPanel",
		webview: {
			options: { enableScripts: false, localResourceRoots: [] },
			html: "",
			cspSource: "",
			postMessage: vi.fn((msg: unknown) => {
				posted.push(msg);
				return Promise.resolve(true);
			}),
			onDidReceiveMessage: vi.fn((h) => {
				handler = h;
				return { dispose: vi.fn() };
			}),
			asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
		},
		visible: true,
		show: vi.fn(),
		onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
		onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
	};

	panel.resolveWebviewView(
		webview,
		{} as vscode.WebviewViewResolveContext,
		{} as vscode.CancellationToken,
	);

	return {
		panel,
		client,
		ui,
		messages: () => [...posted],
		request: async <P, R>(
			def: RequestDef<P, R>,
			...args: P extends void ? [] : [params: P]
		) => {
			const params = args[0];
			const requestId = `req-${Date.now()}-${Math.random()}`;
			handler?.({ requestId, method: def.method, params });

			await vi.waitFor(
				() => {
					if (
						!posted.some(
							(m) => (m as { requestId?: string }).requestId === requestId,
						)
					) {
						throw new Error("waiting");
					}
				},
				{ timeout: 1000 },
			);

			return posted.find(
				(m) => (m as { requestId?: string }).requestId === requestId,
			) as { success: boolean; data?: R; error?: string };
		},
		command: async <P>(
			def: CommandDef<P>,
			...args: P extends void ? [] : [params: P]
		) => {
			handler?.({ method: def.method, params: args[0] });
			await new Promise((r) => setTimeout(r, 10));
		},
	};
}

describe("TasksPanel", () => {
	beforeEach(() => {
		// Reset shared vscode mocks between tests
		vi.resetAllMocks();
	});

	describe("init", () => {
		it("returns tasks, templates, and baseUrl when logged in", async () => {
			const h = createHarness();
			h.client.getTasks.mockResolvedValue([task()]);
			h.client.getTemplates.mockResolvedValue([template()]);
			h.client.getTemplateVersionPresets.mockResolvedValue([preset()]);

			const res = await h.request(TasksApi.init);

			expect(res).toMatchObject({
				success: true,
				data: {
					tasksSupported: true,
					baseUrl: "https://coder.example.com",
					tasks: [{ id: "task-1" }],
					templates: [{ id: "template-1", presets: [{ id: "preset-1" }] }],
				},
			});
		});

		it("returns empty when not logged in", async () => {
			const h = createHarness();
			h.client.getHost.mockReturnValue(undefined);

			const res = await h.request(TasksApi.init);

			expect(res.success).toBe(true);
			expect(res.data).toMatchObject({ tasks: [], templates: [] });
		});

		it("returns tasksSupported=false on 404", async () => {
			const h = createHarness();
			h.client.getTasks.mockRejectedValue(createAxiosError(404, "Not found"));

			const res = await h.request(TasksApi.init);

			expect(res).toMatchObject({
				success: true,
				data: { tasksSupported: false },
			});
		});
	});

	describe("getTasks", () => {
		it("returns list of tasks", async () => {
			const h = createHarness();
			h.client.getTasks.mockResolvedValue([
				task({ id: "t1" }),
				task({ id: "t2" }),
			]);

			const res = await h.request(TasksApi.getTasks);

			expect(res.success).toBe(true);
			expect(res.data).toHaveLength(2);
		});
	});

	describe("getTask", () => {
		it("returns task by id", async () => {
			const h = createHarness();
			h.client.getTask.mockResolvedValue(task({ id: "task-123" }));

			const res = await h.request(TasksApi.getTask, { taskId: "task-123" });

			expect(res).toMatchObject({ success: true, data: { id: "task-123" } });
		});
	});

	describe("getTemplates", () => {
		it("returns templates with presets", async () => {
			const h = createHarness();
			h.client.getTemplates.mockResolvedValue([template()]);
			h.client.getTemplateVersionPresets.mockResolvedValue([
				preset({ ID: "p1", Name: "Default", Default: true }),
				preset({ ID: "p2", Name: "Custom" }),
			]);

			const res = await h.request(TasksApi.getTemplates);

			expect(res.data?.[0].presets).toEqual([
				{ id: "p1", name: "Default", isDefault: true },
				{ id: "p2", name: "Custom", isDefault: false },
			]);
		});

		it("caches templates", async () => {
			const h = createHarness();
			h.client.getTemplates.mockResolvedValue([template()]);
			h.client.getTemplateVersionPresets.mockResolvedValue([]);

			await h.request(TasksApi.getTemplates);
			await h.request(TasksApi.getTemplates);

			expect(h.client.getTemplates).toHaveBeenCalledTimes(1);
		});
	});

	describe("getTaskDetails", () => {
		it("returns task with logs", async () => {
			const h = createHarness();
			h.client.getTask.mockResolvedValue(task());
			h.client.getTaskLogs.mockResolvedValue({
				logs: [logEntry({ content: "Starting" })],
			});

			const res = await h.request(TasksApi.getTaskDetails, {
				taskId: "task-1",
			});

			expect(res).toMatchObject({
				success: true,
				data: { task: { id: "task-1" }, logsStatus: "ok" },
			});
			expect(res.data?.logs).toHaveLength(1);
		});

		interface LogCachingTestCase {
			name: string;
			state: "complete" | "working";
			expectedCalls: number;
		}
		it("returns logsStatus not_available on 409", async () => {
			const h = createHarness();
			h.client.getTask.mockResolvedValue(task());
			h.client.getTaskLogs.mockRejectedValue(createAxiosError(409, "Conflict"));

			const res = await h.request(TasksApi.getTaskDetails, {
				taskId: "task-1",
			});

			expect(res).toMatchObject({
				success: true,
				data: { logsStatus: "not_available", logs: [] },
			});
		});

		it.each<LogCachingTestCase>([
			{
				name: "caches logs for completed tasks",
				state: "complete",
				expectedCalls: 1,
			},
			{
				name: "refetches logs for active tasks",
				state: "working",
				expectedCalls: 2,
			},
		])("$name", async ({ state, expectedCalls }) => {
			const h = createHarness();
			h.client.getTask.mockResolvedValue(
				task({ current_state: { timestamp: "", state, message: "", uri: "" } }),
			);
			h.client.getTaskLogs.mockResolvedValue({ logs: [logEntry()] });

			await h.request(TasksApi.getTaskDetails, { taskId: "task-1" });
			await h.request(TasksApi.getTaskDetails, { taskId: "task-1" });

			expect(h.client.getTaskLogs).toHaveBeenCalledTimes(expectedCalls);
		});
	});

	describe("createTask", () => {
		it("creates task and notifies", async () => {
			const h = createHarness();
			const newTask = task({ id: "new-task" });
			h.client.createTask.mockResolvedValue(newTask);
			h.client.getTasks.mockResolvedValue([newTask]);

			const res = await h.request(TasksApi.createTask, {
				templateVersionId: "v1",
				prompt: "Build a feature",
				presetId: "preset-1",
			});

			expect(res).toMatchObject({ success: true, data: { id: "new-task" } });
			expect(h.messages()).toContainEqual(
				expect.objectContaining({ type: TasksApi.tasksUpdated.method }),
			);
		});
	});

	describe("deleteTask", () => {
		const deleteMessage = 'Delete task "Test Task"';

		it("deletes task after confirmation", async () => {
			const h = createHarness();
			h.client.getTasks.mockResolvedValue([]);
			h.ui.setResponse(deleteMessage, "Delete");

			const res = await h.request(TasksApi.deleteTask, {
				taskId: "task-1",
				taskName: "Test Task",
			});

			expect(res.success).toBe(true);
			expect(h.client.deleteTask).toHaveBeenCalledWith("me", "task-1");
			expect(h.messages()).toContainEqual(
				expect.objectContaining({ type: TasksApi.tasksUpdated.method }),
			);
		});

		it("does not delete when user cancels", async () => {
			const h = createHarness();
			h.ui.setResponse(deleteMessage, undefined);

			const res = await h.request(TasksApi.deleteTask, {
				taskId: "task-1",
				taskName: "Test Task",
			});

			expect(res.success).toBe(true);
			expect(h.client.deleteTask).not.toHaveBeenCalled();
		});
	});

	describe("pauseTask / resumeTask", () => {
		interface WorkspaceControlTestCase {
			method: typeof TasksApi.pauseTask;
			clientMethod: keyof MockClient;
			taskOverrides: Partial<Task>;
		}
		it.each<WorkspaceControlTestCase>([
			{
				method: TasksApi.pauseTask,
				clientMethod: "stopWorkspace",
				taskOverrides: { workspace_id: "ws-1" },
			},
			{
				method: TasksApi.resumeTask,
				clientMethod: "startWorkspace",
				taskOverrides: { workspace_id: "ws-1", template_version_id: "tv-1" },
			},
		])(
			"$method.method calls $clientMethod",
			async ({ method, clientMethod, taskOverrides }) => {
				const h = createHarness();
				h.client.getTask.mockResolvedValue(task(taskOverrides));

				const res = await h.request(method, {
					taskId: "task-1",
					taskName: "Test Task",
				});

				expect(res.success).toBe(true);
				expect(h.client[clientMethod]).toHaveBeenCalled();
			},
		);

		it("pauseTask fails when no workspace", async () => {
			const h = createHarness();
			h.client.getTask.mockResolvedValue(task({ workspace_id: null }));

			const res = await h.request(TasksApi.pauseTask, {
				taskId: "task-1",
				taskName: "Test Task",
			});

			expect(res.success).toBe(false);
			expect(res.error).toContain("no workspace");
		});
	});

	describe("sendTaskMessage", () => {
		interface SendTestCase {
			name: string;
			taskOverrides: Partial<Task>;
			resumesWorkspace: boolean;
		}
		it.each<SendTestCase>([
			{
				name: "active task with idle state",
				taskOverrides: { status: "active", current_state: taskState("idle") },
				resumesWorkspace: false,
			},
			{
				name: "paused task (resumes first)",
				taskOverrides: {
					status: "paused",
					workspace_id: "ws-1",
					template_version_id: "tv-1",
				},
				resumesWorkspace: true,
			},
		])("sends input for $name", async ({ taskOverrides, resumesWorkspace }) => {
			const h = createHarness();
			h.client.getTask.mockResolvedValue(task(taskOverrides));

			const res = await h.request(TasksApi.sendTaskMessage, {
				taskId: "task-1",
				message: "Hello",
			});

			expect(res.success).toBe(true);
			expect(h.client.sendTaskInput).toHaveBeenCalledWith(
				"me",
				"task-1",
				"Hello",
			);
			if (resumesWorkspace) {
				expect(h.client.startWorkspace).toHaveBeenCalledWith("ws-1", "tv-1");
			} else {
				expect(h.client.startWorkspace).not.toHaveBeenCalled();
			}
		});

		interface SendErrorTestCase {
			name: string;
			taskOverrides: Partial<Task>;
			sendError?: ReturnType<typeof createAxiosError>;
			expectedError: string;
		}
		it.each<SendErrorTestCase>([
			{
				name: "409 conflict (task pending/paused)",
				taskOverrides: { status: "active", current_state: taskState("idle") },
				sendError: createAxiosError(409, "Conflict"),
				expectedError: "Task is not ready to receive messages",
			},
			{
				name: "400 bad request (task error/unknown)",
				taskOverrides: { status: "active", current_state: taskState("idle") },
				sendError: createAxiosError(400, "Bad Request"),
				expectedError: "Task is not ready to receive messages",
			},
			{
				name: "paused task with no workspace",
				taskOverrides: { status: "paused", workspace_id: null },
				expectedError: "no workspace",
			},
		])(
			"fails on $name",
			async ({ taskOverrides, sendError, expectedError }) => {
				const h = createHarness();
				h.client.getTask.mockResolvedValue(task(taskOverrides));
				if (sendError) {
					h.client.sendTaskInput.mockRejectedValue(sendError);
				}

				const res = await h.request(TasksApi.sendTaskMessage, {
					taskId: "task-1",
					message: "Hello",
				});

				expect(res.success).toBe(false);
				expect(res.error).toContain(expectedError);
			},
		);
	});

	describe("viewInCoder / viewLogs", () => {
		interface OpenExternalTestCase {
			name: string;
			method: CommandDef<TaskIdParams>;
			taskOverrides: Partial<Task>;
			expectedUrl: string;
		}
		it.each<OpenExternalTestCase>([
			{
				name: "viewInCoder opens task URL",
				method: TasksApi.viewInCoder,
				taskOverrides: { id: "task-123", owner_name: "alice" },
				expectedUrl: "https://coder.example.com/tasks/alice/task-123",
			},
			{
				name: "viewLogs opens build URL when workspace exists",
				method: TasksApi.viewLogs,
				taskOverrides: {
					owner_name: "alice",
					workspace_name: "my-ws",
					workspace_build_number: 42,
				},
				expectedUrl: "https://coder.example.com/@alice/my-ws/builds/42",
			},
			{
				name: "viewLogs opens task URL when no workspace",
				method: TasksApi.viewLogs,
				taskOverrides: {
					id: "task-1",
					owner_name: "alice",
					workspace_name: "",
				},
				expectedUrl: "https://coder.example.com/tasks/alice/task-1",
			},
		])("$name", async ({ method, taskOverrides, expectedUrl }) => {
			const h = createHarness();
			h.client.getTask.mockResolvedValue(task(taskOverrides));

			await h.command(method, { taskId: "task-1" });

			expect(vscode.env.openExternal).toHaveBeenCalledWith(
				vscode.Uri.parse(expectedUrl),
			);
		});

		it("viewInCoder does nothing when not logged in", async () => {
			const h = createHarness();
			h.client.getHost.mockReturnValue(undefined);

			await h.command(TasksApi.viewInCoder, { taskId: "task-123" });

			expect(vscode.env.openExternal).not.toHaveBeenCalled();
		});
	});

	describe("downloadLogs", () => {
		it("saves logs to file", async () => {
			const h = createHarness();
			h.client.getTaskLogs.mockResolvedValue({ logs: [logEntry()] });
			const saveUri = vscode.Uri.file("/downloads/logs.txt");
			vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(saveUri);
			h.ui.setResponse(`Logs saved to ${saveUri.fsPath}`, "Open File");

			const res = await h.request(TasksApi.downloadLogs, {
				taskId: "task-1",
			});

			expect(res.success).toBe(true);
			expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
				saveUri,
				expect.any(Buffer),
			);
			expect(vscode.window.showTextDocument).toHaveBeenCalledWith(saveUri);
		});

		it("does not open file when notification is dismissed", async () => {
			const h = createHarness();
			h.client.getTaskLogs.mockResolvedValue({ logs: [logEntry()] });
			const saveUri = vscode.Uri.file("/downloads/logs.txt");
			vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(saveUri);
			h.ui.setResponse(`Logs saved to ${saveUri.fsPath}`, undefined);

			const res = await h.request(TasksApi.downloadLogs, {
				taskId: "task-1",
			});

			expect(res.success).toBe(true);
			expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
				saveUri,
				expect.any(Buffer),
			);
			expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
		});

		it("shows warning when no logs", async () => {
			const h = createHarness();
			h.client.getTaskLogs.mockResolvedValue({ logs: [] });

			const res = await h.request(TasksApi.downloadLogs, {
				taskId: "task-1",
			});

			expect(res.success).toBe(true);
			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				"No logs available to download",
			);
		});

		it("propagates server errors instead of masking them", async () => {
			const h = createHarness();
			h.client.getTaskLogs.mockRejectedValue(
				createAxiosError(500, "Internal server error"),
			);

			const res = await h.request(TasksApi.downloadLogs, {
				taskId: "task-1",
			});

			expect(res.success).toBe(false);
			expect(res.error).toBe("Failed to fetch logs for download");
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to fetch logs for download",
			);
			expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
		});

		it("does nothing when user cancels", async () => {
			const h = createHarness();
			h.client.getTaskLogs.mockResolvedValue({ logs: [logEntry()] });
			vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);

			const res = await h.request(TasksApi.downloadLogs, {
				taskId: "task-1",
			});

			expect(res.success).toBe(true);
			expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
		});
	});

	describe("public methods", () => {
		it("showCreateForm sends notification", () => {
			const h = createHarness();
			h.panel.showCreateForm();
			expect(h.messages()).toContainEqual({
				type: TasksApi.showCreateForm.method,
			});
		});

		it("refresh sends notification", () => {
			const h = createHarness();
			h.panel.refresh();
			expect(h.messages()).toContainEqual({ type: TasksApi.refresh.method });
		});
	});

	describe("error handling", () => {
		it("returns error on request failure", async () => {
			const h = createHarness();
			h.client.getTasks.mockRejectedValue(new Error("Network error"));

			const res = await h.request(TasksApi.init);

			expect(res).toMatchObject({ success: false, error: "Network error" });
		});

		it("handles unknown methods", async () => {
			const h = createHarness();
			const res = await h.request(defineRequest("unknownMethod"));

			expect(res.success).toBe(false);
			expect(res.error).toContain("Unknown method");
		});

		it("propagates template fetch errors during init", async () => {
			const h = createHarness();
			h.client.getTasks.mockResolvedValue([task()]);
			h.client.getTemplates.mockRejectedValue(
				new Error("Template service unavailable"),
			);

			const res = await h.request(TasksApi.init);

			expect(res.success).toBe(false);
			expect(res.error).toContain("Template service unavailable");
		});

		it("createTask succeeds even when refreshing the task list fails", async () => {
			const h = createHarness();
			const newTask = task({ id: "new-task" });
			h.client.createTask.mockResolvedValue(newTask);
			// First call succeeds for init tasks, second fails during refreshAndNotifyTasks
			h.client.getTasks
				.mockResolvedValueOnce([])
				.mockRejectedValueOnce(new Error("Refresh failed"));

			const res = await h.request(TasksApi.createTask, {
				templateVersionId: "v1",
				prompt: "Build a feature",
			});

			expect(res).toMatchObject({ success: true, data: { id: "new-task" } });
		});

		it("shows error notification for user action failures", async () => {
			const h = createHarness();
			h.client.getTask.mockRejectedValue(new Error("Workspace unavailable"));

			const res = await h.request(TasksApi.pauseTask, {
				taskId: "task-1",
				taskName: "Test Task",
			});

			expect(res.success).toBe(false);
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Workspace unavailable",
			);
		});

		it("shows error message when command fails", async () => {
			const h = createHarness();
			h.client.getTask.mockRejectedValue(new Error("Task not found"));

			await h.command(TasksApi.viewInCoder, { taskId: "task-1" });

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Command failed: Task not found",
			);
		});
	});
});
