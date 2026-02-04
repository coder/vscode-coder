import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { TasksPanel } from "@/webviews/tasks/TasksPanel";

import {
	createAxiosError,
	createMockLogger,
	MockUserInteraction,
} from "../../../mocks/testHelpers";

import type {
	Task,
	TaskLogEntry,
	Template,
	Preset,
} from "coder/site/src/api/typesGenerated";

// Use vscode.runtime.ts for the vscode mock
vi.mock("vscode", async () => {
	return await import("../../../mocks/vscode.runtime");
});

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

function createMockClient(baseUrl = "https://coder.example.com"): MockClient {
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

function createMockTask(overrides: Partial<Task> = {}): Task {
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

function createMockTemplate(overrides: Partial<Template> = {}): Template {
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

function createMockPreset(overrides: Partial<Preset> = {}): Preset {
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

function createMockLogEntry(
	overrides: Partial<TaskLogEntry> = {},
): TaskLogEntry {
	return {
		id: 1,
		time: "2024-01-01T00:00:00Z",
		type: "output", // Valid TaskLogType: "input" | "output"
		content: "Test log entry",
		...overrides,
	};
}

interface TestHarness {
	panel: TasksPanel;
	client: MockClient;
	userInteraction: MockUserInteraction;
	sendRequest: <T>(
		method: string,
		params?: unknown,
	) => Promise<{
		success: boolean;
		data?: T;
		error?: string;
	}>;
	sendCommand: (method: string, params?: unknown) => Promise<void>;
	getPostedMessages: () => unknown[];
}

function createTestHarness(): TestHarness {
	const client = createMockClient();
	const logger = createMockLogger();
	const extensionUri = vscode.Uri.file("/test/extension");
	const userInteraction = new MockUserInteraction();

	const panel = new TasksPanel(
		extensionUri,
		client as unknown as ConstructorParameters<typeof TasksPanel>[1],
		logger,
	);

	// Track posted messages
	const postedMessages: unknown[] = [];
	let messageHandler: ((msg: unknown) => void) | null = null;

	const mockWebviewView = {
		webview: {
			options: { enableScripts: false, localResourceRoots: [] },
			html: "",
			postMessage: vi.fn((msg: unknown) => {
				postedMessages.push(msg);
				return Promise.resolve(true);
			}),
			onDidReceiveMessage: vi.fn((handler) => {
				messageHandler = handler;
				return { dispose: vi.fn() };
			}),
			asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
		},
		visible: true,
		onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
		onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
	};

	panel.resolveWebviewView(
		mockWebviewView as unknown as vscode.WebviewView,
		{} as vscode.WebviewViewResolveContext,
		{} as vscode.CancellationToken,
	);

	const sendRequest = async <T>(method: string, params?: unknown) => {
		const requestId = `req-${Date.now()}-${Math.random()}`;

		// messageHandler returns void, but we need to wait for async processing
		messageHandler?.({ requestId, method, params });

		// Wait for the response to appear in posted messages
		await vi.waitFor(
			() => {
				const found = postedMessages.some(
					(m) => (m as { requestId?: string }).requestId === requestId,
				);
				if (!found) {
					throw new Error("Response not yet received");
				}
			},
			{ timeout: 1000 },
		);

		const response = postedMessages.find(
			(m) => (m as { requestId?: string }).requestId === requestId,
		) as { success: boolean; data?: T; error?: string };

		return response;
	};

	const sendCommand = async (method: string, params?: unknown) => {
		messageHandler?.({ method, params });
		// Commands don't return responses, just wait for side effects
		await new Promise((resolve) => setTimeout(resolve, 10));
	};

	return {
		panel,
		client,
		userInteraction,
		sendRequest,
		sendCommand,
		getPostedMessages: () => [...postedMessages],
	};
}

describe("TasksPanel", () => {
	let harness: TestHarness;

	beforeEach(() => {
		vi.resetAllMocks();
		harness = createTestHarness();
	});

	describe("init", () => {
		it("returns tasks, templates, and baseUrl", async () => {
			const task = createMockTask();
			const template = createMockTemplate();
			const preset = createMockPreset();

			harness.client.getTasks.mockResolvedValue([task]);
			harness.client.getTemplates.mockResolvedValue([template]);
			harness.client.getTemplateVersionPresets.mockResolvedValue([preset]);

			const response = await harness.sendRequest<{
				tasks: Task[];
				templates: unknown[];
				baseUrl: string;
				tasksSupported: boolean;
			}>("init");

			expect(response.success).toBe(true);
			expect(response.data?.tasks).toHaveLength(1);
			expect(response.data?.tasks[0].id).toBe("task-1");
			expect(response.data?.templates).toHaveLength(1);
			expect(response.data?.templates[0]).toMatchObject({
				id: "template-1",
				name: "test-template",
				presets: [{ id: "preset-1", name: "Test Preset" }],
			});
			expect(response.data?.baseUrl).toBe("https://coder.example.com");
			expect(response.data?.tasksSupported).toBe(true);
		});

		it("returns empty when not logged in", async () => {
			harness.client.getHost.mockReturnValue(undefined);

			const response = await harness.sendRequest<{
				tasks: Task[];
				templates: unknown[];
			}>("init");

			expect(response.success).toBe(true);
			expect(response.data?.tasks).toEqual([]);
			expect(response.data?.templates).toEqual([]);
		});

		it("returns tasksSupported=false on 404", async () => {
			harness.client.getTasks.mockRejectedValue(
				createAxiosError(404, "Not found"),
			);

			const response = await harness.sendRequest<{
				tasks: Task[];
				tasksSupported: boolean;
			}>("init");

			expect(response.success).toBe(true);
			expect(response.data?.tasks).toEqual([]);
			expect(response.data?.tasksSupported).toBe(false);
		});
	});

	describe("getTasks", () => {
		it("returns list of tasks", async () => {
			const tasks = [
				createMockTask({ id: "t1" }),
				createMockTask({ id: "t2" }),
			];
			harness.client.getTasks.mockResolvedValue(tasks);

			const response = await harness.sendRequest<Task[]>("getTasks");

			expect(response.success).toBe(true);
			expect(response.data).toHaveLength(2);
		});
	});

	describe("getTask", () => {
		it("returns single task by id", async () => {
			const task = createMockTask({ id: "task-123" });
			harness.client.getTask.mockResolvedValue(task);

			const response = await harness.sendRequest<Task>("getTask", {
				taskId: "task-123",
			});

			expect(response.success).toBe(true);
			expect(response.data?.id).toBe("task-123");
		});
	});

	describe("getTemplates", () => {
		it("returns templates with presets", async () => {
			const template = createMockTemplate();
			const presets = [
				createMockPreset({ ID: "p1", Name: "Default", Default: true }),
				createMockPreset({ ID: "p2", Name: "Custom" }),
			];
			harness.client.getTemplates.mockResolvedValue([template]);
			harness.client.getTemplateVersionPresets.mockResolvedValue(presets);

			const response = await harness.sendRequest<unknown[]>("getTemplates");

			expect(response.success).toBe(true);
			expect(response.data?.[0]).toMatchObject({
				id: "template-1",
				presets: [
					{ id: "p1", name: "Default", isDefault: true },
					{ id: "p2", name: "Custom", isDefault: false },
				],
			});
		});

		it("caches templates on subsequent calls", async () => {
			harness.client.getTemplates.mockResolvedValue([createMockTemplate()]);
			harness.client.getTemplateVersionPresets.mockResolvedValue([]);

			await harness.sendRequest("getTemplates");
			await harness.sendRequest("getTemplates");

			// Should only fetch once due to caching
			expect(harness.client.getTemplates).toHaveBeenCalledTimes(1);
		});
	});

	describe("getTaskDetails", () => {
		it("returns task with logs and actions", async () => {
			const task = createMockTask();
			const logs = [createMockLogEntry({ content: "Starting..." })];
			harness.client.getTask.mockResolvedValue(task);
			harness.client.getTaskLogs.mockResolvedValue(logs);

			const response = await harness.sendRequest<{
				task: Task;
				logs: TaskLogEntry[];
				logsStatus: string;
			}>("getTaskDetails", { taskId: "task-1" });

			expect(response.success).toBe(true);
			expect(response.data?.task.id).toBe("task-1");
			expect(response.data?.logs).toHaveLength(1);
			expect(response.data?.logsStatus).toBe("ok");
		});

		it("caches logs for completed tasks", async () => {
			// Task with state "complete" should cache logs
			// Use valid TaskStatus "pending" and TaskState "complete"
			const completedTask = createMockTask({
				status: "pending",
				current_state: {
					timestamp: "",
					state: "complete",
					message: "",
					uri: "",
				},
			});
			harness.client.getTask.mockResolvedValue(completedTask);
			harness.client.getTaskLogs.mockResolvedValue([createMockLogEntry()]);

			await harness.sendRequest("getTaskDetails", { taskId: "task-1" });
			await harness.sendRequest("getTaskDetails", { taskId: "task-1" });

			// Logs should only be fetched once for stable state
			expect(harness.client.getTaskLogs).toHaveBeenCalledTimes(1);
		});

		it("does not cache logs for running tasks", async () => {
			const runningTask = createMockTask({ status: "active" });
			harness.client.getTask.mockResolvedValue(runningTask);
			harness.client.getTaskLogs.mockResolvedValue([createMockLogEntry()]);

			await harness.sendRequest("getTaskDetails", { taskId: "task-1" });
			await harness.sendRequest("getTaskDetails", { taskId: "task-1" });

			// Logs fetched each time for active tasks
			expect(harness.client.getTaskLogs).toHaveBeenCalledTimes(2);
		});
	});

	describe("createTask", () => {
		it("creates task and notifies webview", async () => {
			const newTask = createMockTask({ id: "new-task" });
			harness.client.createTask.mockResolvedValue(newTask);
			harness.client.getTasks.mockResolvedValue([newTask]);

			const response = await harness.sendRequest<Task>("createTask", {
				templateVersionId: "v1",
				prompt: "Build a feature",
				presetId: "preset-1",
			});

			expect(response.success).toBe(true);
			expect(response.data?.id).toBe("new-task");

			// Check notification was sent
			const notifications = harness
				.getPostedMessages()
				.filter((m) => (m as { type?: string }).type === "tasksUpdated");
			expect(notifications).toHaveLength(1);
		});
	});

	describe("deleteTask", () => {
		it("deletes task and notifies webview", async () => {
			harness.client.getTasks.mockResolvedValue([]);

			const response = await harness.sendRequest("deleteTask", {
				taskId: "task-1",
			});

			expect(response.success).toBe(true);
			expect(harness.client.deleteTask).toHaveBeenCalledWith("me", "task-1");

			const notifications = harness
				.getPostedMessages()
				.filter((m) => (m as { type?: string }).type === "tasksUpdated");
			expect(notifications).toHaveLength(1);
		});
	});

	describe("pauseTask", () => {
		it("stops workspace for task", async () => {
			const task = createMockTask({ workspace_id: "ws-1" });
			harness.client.getTask.mockResolvedValue(task);
			harness.client.getTasks.mockResolvedValue([task]);

			const response = await harness.sendRequest("pauseTask", {
				taskId: "task-1",
			});

			expect(response.success).toBe(true);
			expect(harness.client.stopWorkspace).toHaveBeenCalledWith("ws-1");
		});

		it("fails when task has no workspace", async () => {
			const task = createMockTask({ workspace_id: null });
			harness.client.getTask.mockResolvedValue(task);

			const response = await harness.sendRequest("pauseTask", {
				taskId: "task-1",
			});

			expect(response.success).toBe(false);
			expect(response.error).toContain("no workspace");
		});
	});

	describe("resumeTask", () => {
		it("starts workspace for task", async () => {
			const task = createMockTask({
				workspace_id: "ws-1",
				template_version_id: "tv-1",
			});
			harness.client.getTask.mockResolvedValue(task);
			harness.client.getTasks.mockResolvedValue([task]);

			const response = await harness.sendRequest("resumeTask", {
				taskId: "task-1",
			});

			expect(response.success).toBe(true);
			expect(harness.client.startWorkspace).toHaveBeenCalledWith(
				"ws-1",
				"tv-1",
			);
		});
	});

	describe("viewInCoder", () => {
		it("opens task URL in browser", async () => {
			const task = createMockTask({ id: "task-123", owner_name: "alice" });
			harness.client.getTask.mockResolvedValue(task);

			await harness.sendCommand("viewInCoder", { taskId: "task-123" });

			expect(harness.userInteraction.getExternalUrls()).toContain(
				"https://coder.example.com/tasks/alice/task-123",
			);
		});

		it("does nothing when not logged in", async () => {
			harness.client.getHost.mockReturnValue(undefined);

			await harness.sendCommand("viewInCoder", { taskId: "task-123" });

			expect(harness.userInteraction.getExternalUrls()).toHaveLength(0);
		});
	});

	describe("viewLogs", () => {
		it("opens build logs URL when workspace exists", async () => {
			const task = createMockTask({
				owner_name: "alice",
				workspace_name: "my-workspace",
				workspace_build_number: 42,
			});
			harness.client.getTask.mockResolvedValue(task);

			await harness.sendCommand("viewLogs", { taskId: "task-1" });

			expect(harness.userInteraction.getExternalUrls()).toContain(
				"https://coder.example.com/@alice/my-workspace/builds/42",
			);
		});

		it("opens task URL when no workspace name", async () => {
			const task = createMockTask({
				id: "task-1",
				owner_name: "alice",
				workspace_name: "", // Empty string, not null
				workspace_build_number: undefined,
			});
			harness.client.getTask.mockResolvedValue(task);

			await harness.sendCommand("viewLogs", { taskId: "task-1" });

			expect(harness.userInteraction.getExternalUrls()).toContain(
				"https://coder.example.com/tasks/alice/task-1",
			);
		});
	});

	describe("downloadLogs", () => {
		it("saves logs to file when user selects location", async () => {
			const logs = [
				createMockLogEntry({
					time: "2024-01-01T00:00:00Z",
					type: "input",
					content: "Starting",
				}),
				createMockLogEntry({
					time: "2024-01-01T00:01:00Z",
					type: "output",
					content: "Completed",
				}),
			];
			harness.client.getTaskLogs.mockResolvedValue(logs);

			const saveUri = vscode.Uri.file("/downloads/logs.txt");
			vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(saveUri);

			await harness.sendCommand("downloadLogs", { taskId: "task-1" });

			expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
				saveUri,
				expect.any(Buffer),
			);
		});

		it("shows warning when no logs available", async () => {
			harness.client.getTaskLogs.mockResolvedValue([]);

			await harness.sendCommand("downloadLogs", { taskId: "task-1" });

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				"No logs available to download",
			);
		});

		it("does nothing when user cancels save dialog", async () => {
			harness.client.getTaskLogs.mockResolvedValue([createMockLogEntry()]);
			vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);

			await harness.sendCommand("downloadLogs", { taskId: "task-1" });

			expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
		});
	});

	describe("sendTaskMessage", () => {
		it("shows not supported message", async () => {
			await harness.sendCommand("sendTaskMessage", {
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
			harness.panel.showCreateForm();

			const messages = harness.getPostedMessages();
			expect(messages).toContainEqual({ type: "showCreateForm" });
		});

		it("refresh clears caches and sends notification", () => {
			harness.panel.refresh();

			const messages = harness.getPostedMessages();
			expect(messages).toContainEqual({ type: "refresh" });
		});
	});

	describe("error handling", () => {
		it("returns error response on request failure", async () => {
			harness.client.getTasks.mockRejectedValue(new Error("Network error"));

			const response = await harness.sendRequest("init");

			expect(response.success).toBe(false);
			expect(response.error).toBe("Network error");
		});

		it("handles unknown methods gracefully", async () => {
			const response = await harness.sendRequest("unknownMethod");

			expect(response.success).toBe(false);
			expect(response.error).toContain("Unknown method");
		});
	});
});
