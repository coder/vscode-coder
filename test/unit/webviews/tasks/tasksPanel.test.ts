import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { TasksPanel } from "@/webviews/tasks/tasksPanel";

import { TasksApi, type ParamsOf, type ResponseOf } from "@repo/shared";

import { logEntry, preset, task, template } from "../../../mocks/tasks";
import { createAxiosError, createMockLogger } from "../../../mocks/testHelpers";

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
	| "getHost"
>;

type MockClient = { [K in keyof TasksPanelClient]: ReturnType<typeof vi.fn> };

function createClient(baseUrl = "https://coder.example.com"): MockClient {
	return {
		getTasks: vi.fn().mockResolvedValue([]),
		getTask: vi.fn(),
		getTaskLogs: vi.fn().mockResolvedValue([]),
		createTask: vi.fn(),
		deleteTask: vi.fn().mockResolvedValue(undefined),
		getTemplates: vi.fn().mockResolvedValue([]),
		getTemplateVersionPresets: vi.fn().mockResolvedValue([]),
		startWorkspace: vi.fn().mockResolvedValue(undefined),
		stopWorkspace: vi.fn().mockResolvedValue(undefined),
		getHost: vi.fn().mockReturnValue(baseUrl),
	};
}

interface ApiDef {
	method: string;
}

interface Harness {
	panel: TasksPanel;
	client: MockClient;
	/** Type-safe request using TasksApi definitions */
	request: <T extends ApiDef>(
		def: T,
		params?: ParamsOf<T>,
	) => Promise<{ success: boolean; data?: ResponseOf<T>; error?: string }>;
	command: (method: string, params?: unknown) => Promise<void>;
	messages: () => unknown[];
}

function createHarness(): Harness {
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
		messages: () => [...posted],
		request: async <T extends ApiDef>(def: T, params?: ParamsOf<T>) => {
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
			) as { success: boolean; data?: ResponseOf<T>; error?: string };
		},
		command: async (method: string, params?: unknown) => {
			handler?.({ method, params });
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
			h.client.getTaskLogs.mockResolvedValue([
				logEntry({ content: "Starting" }),
			]);

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
			h.client.getTaskLogs.mockResolvedValue([logEntry()]);

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
				expect.objectContaining({ type: "tasksUpdated" }),
			);
		});
	});

	describe("deleteTask", () => {
		it("deletes task and notifies", async () => {
			const h = createHarness();
			h.client.getTasks.mockResolvedValue([]);

			const res = await h.request(TasksApi.deleteTask, { taskId: "task-1" });

			expect(res.success).toBe(true);
			expect(h.client.deleteTask).toHaveBeenCalledWith("me", "task-1");
			expect(h.messages()).toContainEqual(
				expect.objectContaining({ type: "tasksUpdated" }),
			);
		});
	});

	describe("pauseTask / resumeTask", () => {
		interface WorkspaceControlTestCase {
			method: typeof TasksApi.pauseTask | typeof TasksApi.resumeTask;
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
				h.client.getTasks.mockResolvedValue([]);

				const res = await h.request(method, { taskId: "task-1" });

				expect(res.success).toBe(true);
				expect(h.client[clientMethod]).toHaveBeenCalled();
			},
		);

		it("pauseTask fails when no workspace", async () => {
			const h = createHarness();
			h.client.getTask.mockResolvedValue(task({ workspace_id: null }));

			const res = await h.request(TasksApi.pauseTask, { taskId: "task-1" });

			expect(res.success).toBe(false);
			expect(res.error).toContain("no workspace");
		});
	});

	describe("viewInCoder / viewLogs", () => {
		interface OpenExternalTestCase {
			name: string;
			method: "viewInCoder" | "viewLogs";
			taskOverrides: Partial<Task>;
			expectedUrl: string;
		}
		it.each<OpenExternalTestCase>([
			{
				name: "viewInCoder opens task URL",
				method: "viewInCoder",
				taskOverrides: { id: "task-123", owner_name: "alice" },
				expectedUrl: "https://coder.example.com/tasks/alice/task-123",
			},
			{
				name: "viewLogs opens build URL when workspace exists",
				method: "viewLogs",
				taskOverrides: {
					owner_name: "alice",
					workspace_name: "my-ws",
					workspace_build_number: 42,
				},
				expectedUrl: "https://coder.example.com/@alice/my-ws/builds/42",
			},
			{
				name: "viewLogs opens task URL when no workspace",
				method: "viewLogs",
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

			await h.command("viewInCoder", { taskId: "task-123" });

			expect(vscode.env.openExternal).not.toHaveBeenCalled();
		});
	});

	describe("downloadLogs", () => {
		it("saves logs to file", async () => {
			const h = createHarness();
			h.client.getTaskLogs.mockResolvedValue([logEntry()]);
			const saveUri = vscode.Uri.file("/downloads/logs.txt");
			vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(saveUri);

			await h.command("downloadLogs", { taskId: "task-1" });

			expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
				saveUri,
				expect.any(Buffer),
			);
		});

		it("shows warning when no logs", async () => {
			const h = createHarness();
			h.client.getTaskLogs.mockResolvedValue([]);

			await h.command("downloadLogs", { taskId: "task-1" });

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				"No logs available to download",
			);
		});

		it("does nothing when user cancels", async () => {
			const h = createHarness();
			h.client.getTaskLogs.mockResolvedValue([logEntry()]);
			vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);

			await h.command("downloadLogs", { taskId: "task-1" });

			expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
		});
	});

	describe("sendTaskMessage", () => {
		it("shows not supported message", async () => {
			const h = createHarness();
			await h.command("sendTaskMessage", {
				taskId: "task-1",
				message: "hello",
			});

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("not yet supported"),
			);
		});
	});

	describe("public methods", () => {
		it("showCreateForm sends notification", () => {
			const h = createHarness();
			h.panel.showCreateForm();
			expect(h.messages()).toContainEqual({ type: "showCreateForm" });
		});

		it("refresh sends notification", () => {
			const h = createHarness();
			h.panel.refresh();
			expect(h.messages()).toContainEqual({ type: "refresh" });
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
			const res = await h.request({ method: "unknownMethod" });

			expect(res.success).toBe(false);
			expect(res.error).toContain("Unknown method");
		});
	});
});
