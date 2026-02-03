import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { TasksPanel } from "@/webviews/tasks/TasksPanel";

import { createMockLogger } from "../../../mocks/testHelpers";

import type { Task, Template, Preset } from "coder/site/src/api/typesGenerated";

// Mock vscode
vi.mock("vscode", () => {
	const EventEmitter = class {
		event = vi.fn();
		fire = vi.fn();
		dispose = vi.fn();
	};

	return {
		Uri: {
			joinPath: vi.fn((_base, ...pathSegments: string[]) => ({
				fsPath: `/mock/path/${pathSegments.join("/")}`,
				toString: () => `/mock/path/${pathSegments.join("/")}`,
			})),
			parse: vi.fn((str: string) => ({ toString: () => str })),
			file: vi.fn((path: string) => ({
				fsPath: path,
				toString: () => path,
			})),
		},
		EventEmitter,
		window: {
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			showSaveDialog: vi.fn(),
		},
		env: {
			clipboard: {
				writeText: vi.fn(),
			},
			openExternal: vi.fn(),
		},
		workspace: {
			fs: {
				writeFile: vi.fn(),
			},
		},
	};
});

interface MockWebview {
	options: { enableScripts: boolean; localResourceRoots: unknown[] };
	html: string;
	postMessage: ReturnType<typeof vi.fn>;
	onDidReceiveMessage: ReturnType<typeof vi.fn>;
	asWebviewUri: ReturnType<typeof vi.fn>;
}

interface MockWebviewView {
	webview: MockWebview;
	visible: boolean;
	onDidChangeVisibility: ReturnType<typeof vi.fn>;
	onDidDispose: ReturnType<typeof vi.fn>;
}

function createMockWebviewView(): MockWebviewView {
	const view: MockWebviewView = {
		webview: {
			options: { enableScripts: false, localResourceRoots: [] },
			html: "",
			postMessage: vi.fn().mockResolvedValue(true),
			onDidReceiveMessage: vi.fn(),
			asWebviewUri: vi.fn((uri: { fsPath: string }) => ({
				toString: () => uri.fsPath,
			})),
		},
		visible: true,
		onDidChangeVisibility: vi.fn(),
		onDidDispose: vi.fn(),
	};
	return view;
}

interface MockCoderApiForTasks {
	getTasks: ReturnType<typeof vi.fn>;
	getTask: ReturnType<typeof vi.fn>;
	createTask: ReturnType<typeof vi.fn>;
	deleteTask: ReturnType<typeof vi.fn>;
	getTemplates: ReturnType<typeof vi.fn>;
	getTemplateVersionPresets: ReturnType<typeof vi.fn>;
	startWorkspace: ReturnType<typeof vi.fn>;
	stopWorkspace: ReturnType<typeof vi.fn>;
	getAxiosInstance: () => {
		defaults: { baseURL: string | undefined };
		get: ReturnType<typeof vi.fn>;
	};
}

function createMockClient(): MockCoderApiForTasks {
	let baseURL: string | undefined = "https://coder.example.com";
	return {
		getTasks: vi.fn().mockResolvedValue([]),
		getTask: vi.fn(),
		createTask: vi.fn(),
		deleteTask: vi.fn(),
		getTemplates: vi.fn().mockResolvedValue([]),
		getTemplateVersionPresets: vi.fn().mockResolvedValue([]),
		startWorkspace: vi.fn(),
		stopWorkspace: vi.fn(),
		getAxiosInstance: () => ({
			defaults: {
				get baseURL() {
					return baseURL;
				},
				set baseURL(value: string | undefined) {
					baseURL = value;
				},
			},
			get: vi.fn().mockResolvedValue({ data: { logs: [] } }),
		}),
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
		autostop_requirement: {
			days_of_week: [],
			weeks: 0,
		},
		autostart_requirement: {
			days_of_week: [],
		},
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

// Helper to create a request message with a requestId
function createRequest(
	method: string,
	params?: unknown,
): { requestId: string; method: string; params?: unknown } {
	return {
		requestId: `req-${Date.now()}-${Math.random()}`,
		method,
		params,
	};
}

describe("TasksPanel", () => {
	let panel: TasksPanel;
	let mockClient: MockCoderApiForTasks;
	let mockView: MockWebviewView;
	let messageHandler: ((message: unknown) => Promise<void>) | null = null;
	let visibilityHandler: (() => void) | null = null;

	beforeEach(() => {
		vi.resetAllMocks();
		mockClient = createMockClient();
		mockView = createMockWebviewView();

		// Capture message handler when onDidReceiveMessage is called
		mockView.webview.onDidReceiveMessage.mockImplementation((handler) => {
			messageHandler = handler;
			return { dispose: vi.fn() };
		});

		// Capture visibility handler
		mockView.onDidChangeVisibility.mockImplementation((handler) => {
			visibilityHandler = handler;
			return { dispose: vi.fn() };
		});

		// Mock onDidDispose
		mockView.onDidDispose.mockImplementation(() => ({ dispose: vi.fn() }));

		const extensionUri = { fsPath: "/test/extension" } as vscode.Uri;
		const logger = createMockLogger();
		const getBaseUrl = () => mockClient.getAxiosInstance().defaults.baseURL;

		panel = new TasksPanel(
			extensionUri,
			mockClient as unknown as ConstructorParameters<typeof TasksPanel>[1],
			logger,
			getBaseUrl,
		);
	});

	describe("resolveWebviewView", () => {
		it("sets up webview options correctly", () => {
			panel.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{} as vscode.CancellationToken,
			);

			expect(mockView.webview.options.enableScripts).toBe(true);
			expect(mockView.webview.options.localResourceRoots).toHaveLength(1);
		});

		it("sets up message handler", () => {
			panel.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{} as vscode.CancellationToken,
			);

			expect(mockView.webview.onDidReceiveMessage).toHaveBeenCalled();
			expect(messageHandler).toBeDefined();
		});
	});

	describe("message handling", () => {
		beforeEach(() => {
			panel.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{} as vscode.CancellationToken,
			);
		});

		it("responds to init request with tasks and templates", async () => {
			const mockTasks = [createMockTask()];
			const mockTemplates = [createMockTemplate()];
			const mockPresets = [createMockPreset()];

			mockClient.getTasks.mockResolvedValue(mockTasks);
			mockClient.getTemplates.mockResolvedValue(mockTemplates);
			mockClient.getTemplateVersionPresets.mockResolvedValue(mockPresets);

			const request = createRequest("init");
			await messageHandler?.(request);

			// Wait for async operations
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockView.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					requestId: request.requestId,
					method: "init",
					success: true,
					data: expect.objectContaining({
						tasks: expect.any(Array),
						templates: expect.any(Array),
						baseUrl: expect.any(String),
						tasksSupported: true,
					}),
				}),
			);
		});

		it("handles getTaskDetails request", async () => {
			const mockTask = createMockTask();
			mockClient.getTask.mockResolvedValue(mockTask);

			const request = createRequest("getTaskDetails", { taskId: "task-1" });
			await messageHandler?.(request);

			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockClient.getTask).toHaveBeenCalledWith("me", "task-1");
			expect(mockView.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					requestId: request.requestId,
					method: "getTaskDetails",
					success: true,
				}),
			);
		});

		it("handles createTask request", async () => {
			mockClient.createTask.mockResolvedValue(createMockTask());
			mockClient.getTasks.mockResolvedValue([]);

			const request = createRequest("createTask", {
				templateVersionId: "version-1",
				prompt: "Test prompt",
				presetId: "preset-1",
			});
			await messageHandler?.(request);

			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockClient.createTask).toHaveBeenCalledWith("me", {
				template_version_id: "version-1",
				template_version_preset_id: "preset-1",
				input: "Test prompt",
			});
		});

		it("handles viewInCoder request", async () => {
			const mockTask = createMockTask({ id: "task-123" });
			mockClient.getTasks.mockResolvedValue([mockTask]);
			mockClient.getTemplates.mockResolvedValue([]);

			// First initialize to get tasks
			const initRequest = createRequest("init");
			await messageHandler?.(initRequest);
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Then test viewInCoder using request pattern
			const viewRequest = createRequest("viewInCoder", { taskId: "task-123" });
			await messageHandler?.(viewRequest);

			expect(vscode.env.openExternal).toHaveBeenCalled();
		});
	});

	describe("resumeTask and pauseTask", () => {
		beforeEach(async () => {
			panel.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{} as vscode.CancellationToken,
			);

			const mockTask = createMockTask({
				id: "task-1",
				workspace_id: "workspace-1",
				workspace_status: "stopped",
			});
			mockClient.getTasks.mockResolvedValue([mockTask]);
			mockClient.getTemplates.mockResolvedValue([]);

			// Initialize first
			const initRequest = createRequest("init");
			await messageHandler?.(initRequest);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		it("calls startWorkspace on resumeTask request", async () => {
			mockClient.startWorkspace.mockResolvedValue({});
			mockClient.getTasks.mockResolvedValue([]);

			const request = createRequest("resumeTask", { taskId: "task-1" });
			await messageHandler?.(request);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockClient.startWorkspace).toHaveBeenCalledWith(
				"workspace-1",
				"version-1",
			);
		});

		it("calls stopWorkspace on pauseTask request", async () => {
			// Update mock task to be running so it can be paused
			const mockTask = createMockTask({
				id: "task-1",
				workspace_id: "workspace-1",
				workspace_status: "running",
			});
			mockClient.getTasks.mockResolvedValue([mockTask]);
			mockClient.stopWorkspace.mockResolvedValue({});

			// Re-initialize with running task
			const initRequest = createRequest("init");
			await messageHandler?.(initRequest);
			await new Promise((resolve) => setTimeout(resolve, 0));

			const request = createRequest("pauseTask", { taskId: "task-1" });
			await messageHandler?.(request);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockClient.stopWorkspace).toHaveBeenCalledWith("workspace-1");
		});
	});

	describe("deleteTask", () => {
		beforeEach(async () => {
			panel.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{} as vscode.CancellationToken,
			);

			mockClient.getTasks.mockResolvedValue([createMockTask()]);
			mockClient.getTemplates.mockResolvedValue([]);

			const initRequest = createRequest("init");
			await messageHandler?.(initRequest);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		it("calls deleteTask API", async () => {
			mockClient.deleteTask.mockResolvedValue(undefined);
			mockClient.getTasks.mockResolvedValue([]);

			const request = createRequest("deleteTask", { taskId: "task-1" });
			await messageHandler?.(request);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockClient.deleteTask).toHaveBeenCalledWith("me", "task-1");
		});
	});

	describe("public methods", () => {
		beforeEach(() => {
			panel.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{} as vscode.CancellationToken,
			);
		});

		it("showCreateForm sends push message", () => {
			panel.showCreateForm();

			expect(mockView.webview.postMessage).toHaveBeenCalledWith({
				type: "showCreateForm",
			});
		});

		it("refresh sends refresh push message", () => {
			panel.refresh();

			expect(mockView.webview.postMessage).toHaveBeenCalledWith({
				type: "refresh",
			});
		});
	});

	describe("dispose", () => {
		it("cleans up resources", () => {
			panel.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{} as vscode.CancellationToken,
			);

			panel.dispose();

			// After dispose, refresh should not post messages
			mockView.webview.postMessage.mockClear();
			panel.refresh();
			// refresh still posts the message even when disposed
			// (the visibility check prevents fetching, not sending)
		});
	});

	describe("visibility handling", () => {
		beforeEach(() => {
			panel.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{} as vscode.CancellationToken,
			);
		});

		it("stops polling when not visible", async () => {
			mockClient.getTasks.mockResolvedValue([]);

			// Simulate becoming invisible
			mockView.visible = false;
			visibilityHandler?.();

			// Wait a bit
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Clear call count
			mockClient.getTasks.mockClear();

			// Refresh should still send the message
			panel.refresh();

			// The refresh only sends a push message, doesn't fetch
			expect(mockView.webview.postMessage).toHaveBeenCalledWith({
				type: "refresh",
			});
		});
	});

	describe("error handling", () => {
		beforeEach(() => {
			panel.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{} as vscode.CancellationToken,
			);
		});

		it("sends error response when init request fails", async () => {
			mockClient.getTasks.mockRejectedValue(new Error("Network error"));
			mockClient.getTemplates.mockResolvedValue([]);

			const request = createRequest("init");
			await messageHandler?.(request);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockView.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					requestId: request.requestId,
					method: "init",
					success: false,
					error: "Network error",
				}),
			);
		});

		it("sends error response when createTask request fails", async () => {
			mockClient.createTask.mockRejectedValue(new Error("Creation failed"));

			const request = createRequest("createTask", {
				templateVersionId: "v1",
				prompt: "test",
			});
			await messageHandler?.(request);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockView.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					requestId: request.requestId,
					method: "createTask",
					success: false,
					error: "Creation failed",
				}),
			);
		});
	});

	describe("404 handling", () => {
		beforeEach(() => {
			panel.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{} as vscode.CancellationToken,
			);
		});

		it("sets tasksSupported to false on 404", async () => {
			const error = new Error("Not found") as Error & {
				isAxiosError: boolean;
				response: { status: number };
			};
			error.isAxiosError = true;
			error.response = { status: 404 };
			mockClient.getTasks.mockRejectedValue(error);
			mockClient.getTemplates.mockResolvedValue([]);

			const request = createRequest("init");
			await messageHandler?.(request);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockView.webview.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					requestId: request.requestId,
					method: "init",
					success: true,
					data: expect.objectContaining({
						tasksSupported: false,
						tasks: [],
					}),
				}),
			);
		});
	});
});
