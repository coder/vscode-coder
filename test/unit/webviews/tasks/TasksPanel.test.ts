import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { TasksPanel } from "@/webviews/tasks/TasksPanel";

import { createAxiosError, createMockLogger } from "../../../mocks/testHelpers";

import type {
	Task,
	TaskLogEntry,
	Template,
	Preset,
} from "coder/site/src/api/typesGenerated";

vi.mock("vscode", async () => {
	return await import("../../../mocks/vscode.runtime");
});

function task(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		organization_id: "org-1",
		owner_id: "owner-1",
		owner_name: "testuser",
		name: "test-task",
		display_name: "Test Task",
		template_id: "template-1",
		template_version_id: "version-1",
		template_name: "test-template",
		template_display_name: "Test Template",
		template_icon: "/icon.svg",
		workspace_id: "workspace-1",
		workspace_name: "test-workspace",
		workspace_status: "running",
		workspace_build_number: 5,
		workspace_agent_id: null,
		workspace_agent_lifecycle: null,
		workspace_agent_health: null,
		workspace_app_id: null,
		initial_prompt: "Test prompt",
		status: "active",
		current_state: {
			timestamp: "2024-01-01T00:00:00Z",
			state: "working",
			message: "Processing",
			uri: "",
		},
		created_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
		...overrides,
	};
}

function template(overrides: Partial<Template> = {}): Template {
	return {
		id: "template-1",
		created_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
		organization_id: "org-1",
		organization_name: "test-org",
		organization_display_name: "Test Org",
		organization_icon: "",
		name: "test-template",
		display_name: "Test Template",
		provisioner: "terraform",
		active_version_id: "version-1",
		active_user_count: 0,
		build_time_stats: {
			delete: { P50: null, P95: null },
			start: { P50: null, P95: null },
			stop: { P50: null, P95: null },
		},
		description: "Test template",
		deprecated: false,
		deprecation_message: "",
		icon: "/icon.svg",
		default_ttl_ms: 0,
		activity_bump_ms: 0,
		autostop_requirement: { days_of_week: [], weeks: 0 },
		autostart_requirement: { days_of_week: [] },
		created_by_id: "user-1",
		created_by_name: "testuser",
		allow_user_autostart: true,
		allow_user_autostop: true,
		allow_user_cancel_workspace_jobs: true,
		failure_ttl_ms: 0,
		time_til_dormant_ms: 0,
		time_til_dormant_autodelete_ms: 0,
		require_active_version: false,
		max_port_share_level: "public",
		cors_behavior: "passthru",
		use_classic_parameter_flow: false,
		...overrides,
	};
}

function preset(overrides: Partial<Preset> = {}): Preset {
	return {
		ID: "preset-1",
		Name: "Test Preset",
		Parameters: [],
		Default: false,
		DesiredPrebuildInstances: null,
		Description: "Test preset",
		Icon: "",
		...overrides,
	};
}

function logEntry(overrides: Partial<TaskLogEntry> = {}): TaskLogEntry {
	return {
		id: 1,
		time: "2024-01-01T00:00:00Z",
		type: "output",
		content: "Test log entry",
		...overrides,
	};
}

interface MockClient {
	getTasks: ReturnType<typeof vi.fn>;
	getTask: ReturnType<typeof vi.fn>;
	getTaskLogs: ReturnType<typeof vi.fn>;
	createTask: ReturnType<typeof vi.fn>;
	deleteTask: ReturnType<typeof vi.fn>;
	getTemplates: ReturnType<typeof vi.fn>;
	getTemplateVersionPresets: ReturnType<typeof vi.fn>;
	startWorkspace: ReturnType<typeof vi.fn>;
	stopWorkspace: ReturnType<typeof vi.fn>;
	getHost: ReturnType<typeof vi.fn>;
}

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

interface Harness {
	panel: TasksPanel;
	client: MockClient;
	request: <T>(
		method: string,
		params?: unknown,
	) => Promise<{
		success: boolean;
		data?: T;
		error?: string;
	}>;
	command: (method: string, params?: unknown) => Promise<void>;
	messages: () => unknown[];
}

function createHarness(): Harness {
	const client = createClient();
	const panel = new TasksPanel(
		vscode.Uri.file("/test/extension"),
		client as unknown as ConstructorParameters<typeof TasksPanel>[1],
		createMockLogger(),
	);

	const posted: unknown[] = [];
	let handler: ((msg: unknown) => void) | null = null;

	const webview = {
		webview: {
			options: { enableScripts: false, localResourceRoots: [] },
			html: "",
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
		onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
		onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
	};

	panel.resolveWebviewView(
		webview as unknown as vscode.WebviewView,
		{} as vscode.WebviewViewResolveContext,
		{} as vscode.CancellationToken,
	);

	return {
		panel,
		client,
		messages: () => [...posted],
		request: async <T>(method: string, params?: unknown) => {
			const requestId = `req-${Date.now()}-${Math.random()}`;
			handler?.({ requestId, method, params });

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
			) as { success: boolean; data?: T; error?: string };
		},
		command: async (method: string, params?: unknown) => {
			handler?.({ method, params });
			await new Promise((r) => setTimeout(r, 10));
		},
	};
}

// --- Tests ---

describe("TasksPanel", () => {
	let h: Harness;

	beforeEach(() => {
		vi.resetAllMocks();
		h = createHarness();
	});

	describe("init", () => {
		it("returns tasks, templates, and baseUrl when logged in", async () => {
			h.client.getTasks.mockResolvedValue([task()]);
			h.client.getTemplates.mockResolvedValue([template()]);
			h.client.getTemplateVersionPresets.mockResolvedValue([preset()]);

			const res = await h.request<{
				tasks: Task[];
				templates: Array<{ id: string; presets: Array<{ id: string }> }>;
				baseUrl: string;
				tasksSupported: boolean;
			}>("init");

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
			h.client.getHost.mockReturnValue(undefined);

			const res = await h.request<{ tasks: Task[]; templates: unknown[] }>(
				"init",
			);

			expect(res.success).toBe(true);
			expect(res.data).toMatchObject({ tasks: [], templates: [] });
		});

		it("returns tasksSupported=false on 404", async () => {
			h.client.getTasks.mockRejectedValue(createAxiosError(404, "Not found"));

			const res = await h.request<{ tasksSupported: boolean }>("init");

			expect(res).toMatchObject({
				success: true,
				data: { tasksSupported: false },
			});
		});
	});

	describe("getTasks", () => {
		it("returns list of tasks", async () => {
			h.client.getTasks.mockResolvedValue([
				task({ id: "t1" }),
				task({ id: "t2" }),
			]);

			const res = await h.request<Task[]>("getTasks");

			expect(res.success).toBe(true);
			expect(res.data).toHaveLength(2);
		});
	});

	describe("getTask", () => {
		it("returns task by id", async () => {
			h.client.getTask.mockResolvedValue(task({ id: "task-123" }));

			const res = await h.request<Task>("getTask", { taskId: "task-123" });

			expect(res).toMatchObject({ success: true, data: { id: "task-123" } });
		});
	});

	describe("getTemplates", () => {
		it("returns templates with presets", async () => {
			h.client.getTemplates.mockResolvedValue([template()]);
			h.client.getTemplateVersionPresets.mockResolvedValue([
				preset({ ID: "p1", Name: "Default", Default: true }),
				preset({ ID: "p2", Name: "Custom" }),
			]);

			const res =
				await h.request<
					Array<{ presets: Array<{ id: string; isDefault: boolean }> }>
				>("getTemplates");

			expect(res.data?.[0].presets).toEqual([
				{ id: "p1", name: "Default", isDefault: true },
				{ id: "p2", name: "Custom", isDefault: false },
			]);
		});

		it("caches templates", async () => {
			h.client.getTemplates.mockResolvedValue([template()]);
			h.client.getTemplateVersionPresets.mockResolvedValue([]);

			await h.request("getTemplates");
			await h.request("getTemplates");

			expect(h.client.getTemplates).toHaveBeenCalledTimes(1);
		});
	});

	describe("getTaskDetails", () => {
		it("returns task with logs", async () => {
			h.client.getTask.mockResolvedValue(task());
			h.client.getTaskLogs.mockResolvedValue([
				logEntry({ content: "Starting" }),
			]);

			const res = await h.request<{
				task: Task;
				logs: TaskLogEntry[];
				logsStatus: string;
			}>("getTaskDetails", { taskId: "task-1" });

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
			h.client.getTask.mockResolvedValue(
				task({ current_state: { timestamp: "", state, message: "", uri: "" } }),
			);
			h.client.getTaskLogs.mockResolvedValue([logEntry()]);

			await h.request("getTaskDetails", { taskId: "task-1" });
			await h.request("getTaskDetails", { taskId: "task-1" });

			expect(h.client.getTaskLogs).toHaveBeenCalledTimes(expectedCalls);
		});
	});

	describe("createTask", () => {
		it("creates task and notifies", async () => {
			const newTask = task({ id: "new-task" });
			h.client.createTask.mockResolvedValue(newTask);
			h.client.getTasks.mockResolvedValue([newTask]);

			const res = await h.request<Task>("createTask", {
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
			h.client.getTasks.mockResolvedValue([]);

			const res = await h.request("deleteTask", { taskId: "task-1" });

			expect(res.success).toBe(true);
			expect(h.client.deleteTask).toHaveBeenCalledWith("me", "task-1");
			expect(h.messages()).toContainEqual(
				expect.objectContaining({ type: "tasksUpdated" }),
			);
		});
	});

	describe("pauseTask / resumeTask", () => {
		interface WorkspaceControlTestCase {
			method: string;
			clientMethod: keyof MockClient;
			taskOverrides: Partial<Task>;
		}
		it.each<WorkspaceControlTestCase>([
			{
				method: "pauseTask",
				clientMethod: "stopWorkspace",
				taskOverrides: { workspace_id: "ws-1" },
			},
			{
				method: "resumeTask",
				clientMethod: "startWorkspace",
				taskOverrides: { workspace_id: "ws-1", template_version_id: "tv-1" },
			},
		])(
			"$method calls $clientMethod",
			async ({ method, clientMethod, taskOverrides }) => {
				h.client.getTask.mockResolvedValue(task(taskOverrides));
				h.client.getTasks.mockResolvedValue([]);

				const res = await h.request(method, { taskId: "task-1" });

				expect(res.success).toBe(true);
				expect(h.client[clientMethod]).toHaveBeenCalled();
			},
		);

		it("pauseTask fails when no workspace", async () => {
			h.client.getTask.mockResolvedValue(task({ workspace_id: null }));

			const res = await h.request("pauseTask", { taskId: "task-1" });

			expect(res.success).toBe(false);
			expect(res.error).toContain("no workspace");
		});
	});

	describe("viewInCoder / viewLogs", () => {
		interface OpenExternalTestCase {
			name: string;
			method: string;
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
			h.client.getTask.mockResolvedValue(task(taskOverrides));

			await h.command(method, { taskId: "task-1" });

			expect(vscode.env.openExternal).toHaveBeenCalledWith(
				vscode.Uri.parse(expectedUrl),
			);
		});

		it("viewInCoder does nothing when not logged in", async () => {
			h.client.getHost.mockReturnValue(undefined);

			await h.command("viewInCoder", { taskId: "task-123" });

			expect(vscode.env.openExternal).not.toHaveBeenCalled();
		});
	});

	describe("downloadLogs", () => {
		it("saves logs to file", async () => {
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
			h.client.getTaskLogs.mockResolvedValue([]);

			await h.command("downloadLogs", { taskId: "task-1" });

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				"No logs available to download",
			);
		});

		it("does nothing when user cancels", async () => {
			h.client.getTaskLogs.mockResolvedValue([logEntry()]);
			vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);

			await h.command("downloadLogs", { taskId: "task-1" });

			expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
		});
	});

	describe("sendTaskMessage", () => {
		it("shows not supported message", async () => {
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
		interface PublicMethodTestCase {
			method: string;
			expectedType: string;
		}
		it.each<PublicMethodTestCase>([
			{ method: "showCreateForm", expectedType: "showCreateForm" },
			{ method: "refresh", expectedType: "refresh" },
		])("$method sends notification", ({ method, expectedType }) => {
			(h.panel as unknown as Record<string, () => void>)[method]();

			expect(h.messages()).toContainEqual({ type: expectedType });
		});
	});

	describe("error handling", () => {
		it("returns error on request failure", async () => {
			h.client.getTasks.mockRejectedValue(new Error("Network error"));

			const res = await h.request("init");

			expect(res).toMatchObject({ success: false, error: "Network error" });
		});

		it("handles unknown methods", async () => {
			const res = await h.request("unknownMethod");

			expect(res.success).toBe(false);
			expect(res.error).toContain("Unknown method");
		});
	});
});
