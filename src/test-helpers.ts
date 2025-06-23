import type { Api } from "coder/site/src/api/api";
import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceBuild,
} from "coder/site/src/api/typesGenerated";
import { EventEmitter } from "events";
import type { ProxyAgent } from "proxy-agent";
import { vi } from "vitest";
import type * as vscode from "vscode";
import type { Commands } from "./commands";
import { Logger } from "./logger";
import type { Remote } from "./remote";
import type { Storage } from "./storage";
import type { WorkspaceProvider } from "./workspacesProvider";

/**
 * Create a mock WorkspaceAgent with default values
 */
export function createMockAgent(
	overrides: Partial<WorkspaceAgent> = {},
): WorkspaceAgent {
	return {
		id: "agent-id",
		name: "agent-name",
		status: "connected",
		architecture: "amd64",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		version: "v1.0.0",
		operating_system: "linux",
		resource_id: "resource-id",
		instance_id: "",
		directory: "/home/coder",
		apps: [],
		connection_timeout_seconds: 120,
		troubleshooting_url: "",
		lifecycle_state: "ready",
		login_before_ready: true,
		startup_script_timeout_seconds: 300,
		shutdown_script_timeout_seconds: 300,
		subsystems: [],
		...overrides,
	} as WorkspaceAgent;
}

/**
 * Create a mock Workspace with default values
 */
export function createMockWorkspace(
	overrides: Partial<Workspace> = {},
): Workspace {
	return {
		id: "workspace-id",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		owner_id: "owner-id",
		owner_name: "owner",
		owner_avatar_url: "",
		template_id: "template-id",
		template_name: "template",
		template_icon: "",
		template_display_name: "Template",
		template_allow_user_cancel_workspace_jobs: true,
		template_active_version_id: "version-id",
		template_require_active_version: false,
		latest_build: {
			id: "build-id",
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			workspace_id: "workspace-id",
			workspace_name: "workspace",
			workspace_owner_id: "owner-id",
			workspace_owner_name: "owner",
			workspace_owner_avatar_url: "",
			template_version_id: "version-id",
			template_version_name: "v1.0.0",
			build_number: 1,
			transition: "start",
			initiator_id: "initiator-id",
			initiator_name: "initiator",
			job: {
				id: "job-id",
				created_at: new Date().toISOString(),
				started_at: new Date().toISOString(),
				completed_at: new Date().toISOString(),
				status: "succeeded",
				worker_id: "",
				file_id: "file-id",
				tags: {},
				error: "",
				error_code: "",
			},
			reason: "initiator",
			resources: [],
			deadline: new Date().toISOString(),
			status: "running",
			daily_cost: 0,
		},
		name: "workspace",
		autostart_schedule: "",
		ttl_ms: 0,
		last_used_at: new Date().toISOString(),
		deleting_at: "",
		dormant_at: "",
		health: {
			healthy: true,
			failing_agents: [],
		},
		organization_id: "org-id",
		...overrides,
	} as Workspace;
}

/**
 * Create a Workspace with agents in its resources
 */
export function createWorkspaceWithAgents(
	agents: Partial<WorkspaceAgent>[],
): Workspace {
	return createMockWorkspace({
		latest_build: {
			...createMockWorkspace().latest_build,
			resources: [
				{
					id: "resource-id",
					created_at: new Date().toISOString(),
					job_id: "job-id",
					workspace_transition: "start",
					type: "docker_container",
					name: "main",
					hide: false,
					icon: "",
					agents: agents.map((agent) => createMockAgent(agent)),
					metadata: [],
					daily_cost: 0,
				},
			],
		},
	});
}

/**
 * Create a mock VS Code WorkspaceConfiguration with vitest mocks
 */
export function createMockConfiguration(
	defaultValues: Record<string, unknown> = {},
): vscode.WorkspaceConfiguration & {
	get: ReturnType<typeof vi.fn>;
	has: ReturnType<typeof vi.fn>;
	inspect: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
} {
	const get = vi.fn((section: string, defaultValue?: unknown) => {
		return defaultValues[section] ?? defaultValue ?? "";
	});

	const has = vi.fn((section: string) => section in defaultValues);
	const inspect = vi.fn(() => undefined);
	const update = vi.fn(async () => {});

	return {
		get,
		has,
		inspect,
		update,
	} as vscode.WorkspaceConfiguration & {
		get: typeof get;
		has: typeof has;
		inspect: typeof inspect;
		update: typeof update;
	};
}

/**
 * Create a mock output channel and Logger instance for testing
 * Returns both the mock output channel and a real Logger instance
 */
export function createMockOutputChannelWithLogger(options?: {
	verbose?: boolean;
}): {
	mockOutputChannel: {
		appendLine: ReturnType<typeof vi.fn>;
	};
	logger: Logger;
} {
	const mockOutputChannel = {
		appendLine: vi.fn(),
	};
	const logger = new Logger(mockOutputChannel, options);
	return { mockOutputChannel, logger };
}

/**
 * Create a partial mock Storage with only the methods needed
 */
export function createMockStorage(
	overrides: Partial<{
		getHeaders: ReturnType<typeof vi.fn>;
		writeToCoderOutputChannel: ReturnType<typeof vi.fn>;
		getUrl: ReturnType<typeof vi.fn>;
		setUrl: ReturnType<typeof vi.fn>;
		getSessionToken: ReturnType<typeof vi.fn>;
		setSessionToken: ReturnType<typeof vi.fn>;
		configureCli: ReturnType<typeof vi.fn>;
		fetchBinary: ReturnType<typeof vi.fn>;
		getSessionTokenPath: ReturnType<typeof vi.fn>;
		setLogger: ReturnType<typeof vi.fn>;
		migrateSessionToken: ReturnType<typeof vi.fn>;
		readCliConfig: ReturnType<typeof vi.fn>;
		getRemoteSSHLogPath: ReturnType<typeof vi.fn>;
		getNetworkInfoPath: ReturnType<typeof vi.fn>;
		getLogPath: ReturnType<typeof vi.fn>;
	}> = {},
): Storage {
	return {
		getHeaders: overrides.getHeaders ?? vi.fn().mockResolvedValue({}),
		writeToCoderOutputChannel: overrides.writeToCoderOutputChannel ?? vi.fn(),
		getUrl:
			overrides.getUrl ?? vi.fn().mockReturnValue("https://test.coder.com"),
		setUrl: overrides.setUrl ?? vi.fn().mockResolvedValue(undefined),
		getSessionToken:
			overrides.getSessionToken ?? vi.fn().mockResolvedValue("test-token"),
		setSessionToken:
			overrides.setSessionToken ?? vi.fn().mockResolvedValue(undefined),
		configureCli:
			overrides.configureCli ?? vi.fn().mockResolvedValue(undefined),
		fetchBinary:
			overrides.fetchBinary ?? vi.fn().mockResolvedValue("/path/to/coder"),
		getSessionTokenPath:
			overrides.getSessionTokenPath ??
			vi.fn().mockReturnValue("/path/to/token"),
		setLogger: overrides.setLogger ?? vi.fn(),
		migrateSessionToken:
			overrides.migrateSessionToken ?? vi.fn().mockResolvedValue(undefined),
		readCliConfig:
			overrides.readCliConfig ??
			vi.fn().mockResolvedValue({ url: "", token: "" }),
		getRemoteSSHLogPath:
			overrides.getRemoteSSHLogPath ?? vi.fn().mockResolvedValue(undefined),
		getNetworkInfoPath:
			overrides.getNetworkInfoPath ??
			vi.fn().mockReturnValue("/mock/network/info"),
		getLogPath:
			overrides.getLogPath ?? vi.fn().mockReturnValue("/mock/log/path"),
		...overrides,
	} as unknown as Storage;
}

/**
 * Helper to access private properties in tests without type errors
 */
export function getPrivateProperty<T, K extends string>(
	obj: T,
	prop: K,
): unknown {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (obj as any)[prop];
}

/**
 * Helper to set private properties in tests without type errors
 */
export function setPrivateProperty<T, K extends string>(
	obj: T,
	prop: K,
	value: unknown,
): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(obj as any)[prop] = value;
}

/**
 * Create a mock VSCode API with commonly used functions
 */
export function createMockVSCode(): typeof vscode {
	const mockEventEmitter = {
		fire: vi.fn(),
		event: vi.fn(),
		dispose: vi.fn(),
	};

	return {
		window: {
			showInformationMessage: vi.fn().mockResolvedValue(undefined),
			showErrorMessage: vi.fn().mockResolvedValue(undefined),
			showWarningMessage: vi.fn().mockResolvedValue(undefined),
			createQuickPick: vi.fn(() => ({
				items: [],
				onDidChangeSelection: vi.fn(),
				onDidHide: vi.fn(),
				show: vi.fn(),
				hide: vi.fn(),
				dispose: vi.fn(),
				value: "",
				placeholder: "",
				busy: false,
			})),
			createOutputChannel: vi.fn(() => ({
				appendLine: vi.fn(),
				append: vi.fn(),
				clear: vi.fn(),
				dispose: vi.fn(),
				hide: vi.fn(),
				show: vi.fn(),
			})),
			createTerminal: vi.fn(() => ({
				sendText: vi.fn(),
				show: vi.fn(),
				dispose: vi.fn(),
			})),
			showTextDocument: vi.fn(),
			withProgress: vi.fn((options, task) => task()),
			registerUriHandler: vi.fn(),
			createTreeView: vi.fn(() => ({
				visible: true,
				onDidChangeVisibility: mockEventEmitter,
			})),
		},
		workspace: {
			getConfiguration: vi.fn(() => createMockConfiguration()),
			workspaceFolders: [],
			openTextDocument: vi.fn(),
		},
		commands: {
			executeCommand: vi.fn(),
			registerCommand: vi.fn(),
		},
		env: {
			openExternal: vi.fn().mockResolvedValue(true),
			remoteAuthority: undefined,
			logLevel: 2,
		},
		Uri: {
			file: vi.fn((path) => ({ scheme: "file", path, toString: () => path })),
			parse: vi.fn((url) => ({ toString: () => url })),
			from: vi.fn((obj) => obj),
		},
		EventEmitter: class MockEventEmitter {
			fire = vi.fn();
			event = vi.fn();
			dispose = vi.fn();
		},
		TreeItem: class MockTreeItem {
			label: string;
			description?: string;
			tooltip?: string;
			contextValue?: string;
			collapsibleState?: number;
			constructor(label: string, collapsibleState?: number) {
				this.label = label;
				this.collapsibleState = collapsibleState;
			}
		},
		TreeItemCollapsibleState: {
			None: 0,
			Collapsed: 1,
			Expanded: 2,
		},
		ProgressLocation: {
			Notification: 15,
		},
		LogLevel: {
			Off: 0,
			Trace: 1,
			Debug: 2,
			Info: 3,
			Warning: 4,
			Error: 5,
		},
		ConfigurationTarget: {
			Global: 1,
			Workspace: 2,
			WorkspaceFolder: 3,
		},
		extensions: {
			getExtension: vi.fn(),
		},
	} as unknown as typeof vscode;
}

/**
 * Create a mock Coder API client with commonly used methods
 */
export function createMockApi(
	overrides: Partial<{
		getWorkspaces: ReturnType<typeof vi.fn>;
		getWorkspace: ReturnType<typeof vi.fn>;
		getAuthenticatedUser: ReturnType<typeof vi.fn>;
		getAxiosInstance: ReturnType<typeof vi.fn>;
		setHost: ReturnType<typeof vi.fn>;
		setSessionToken: ReturnType<typeof vi.fn>;
		startWorkspace: ReturnType<typeof vi.fn>;
		getWorkspaceBuildByNumber: ReturnType<typeof vi.fn>;
		getWorkspaceBuildLogs: ReturnType<typeof vi.fn>;
		listenToWorkspaceAgentMetadata: ReturnType<typeof vi.fn>;
		updateWorkspaceVersion: ReturnType<typeof vi.fn>;
		getTemplate: ReturnType<typeof vi.fn>;
		getTemplateVersion: ReturnType<typeof vi.fn>;
	}> = {},
): Api {
	const mockAxiosInstance = {
		defaults: {
			baseURL: "https://test.coder.com",
			headers: { common: {} },
		},
		interceptors: {
			request: { use: vi.fn() },
			response: { use: vi.fn() },
		},
	};

	return {
		getWorkspaces:
			overrides.getWorkspaces ?? vi.fn().mockResolvedValue({ workspaces: [] }),
		getWorkspace: overrides.getWorkspace ?? vi.fn().mockResolvedValue({}),
		getAuthenticatedUser:
			overrides.getAuthenticatedUser ??
			vi.fn().mockResolvedValue({
				id: "user-id",
				username: "testuser",
				email: "test@example.com",
				roles: [],
			}),
		getAxiosInstance:
			overrides.getAxiosInstance ?? vi.fn(() => mockAxiosInstance),
		setHost: overrides.setHost ?? vi.fn(),
		setSessionToken: overrides.setSessionToken ?? vi.fn(),
		startWorkspace: overrides.startWorkspace ?? vi.fn().mockResolvedValue({}),
		getWorkspaceBuildByNumber:
			overrides.getWorkspaceBuildByNumber ?? vi.fn().mockResolvedValue({}),
		getWorkspaceBuildLogs:
			overrides.getWorkspaceBuildLogs ?? vi.fn().mockResolvedValue([]),
		listenToWorkspaceAgentMetadata:
			overrides.listenToWorkspaceAgentMetadata ?? vi.fn(),
		updateWorkspaceVersion:
			overrides.updateWorkspaceVersion ?? vi.fn().mockResolvedValue({}),
		...overrides,
	} as unknown as Api;
}

/**
 * Create a mock child process for spawn() testing
 */
export function createMockChildProcess(
	overrides: Partial<{
		stdout: NodeJS.EventEmitter;
		stderr: NodeJS.EventEmitter;
		stdin: NodeJS.EventEmitter;
		pid: number;
		kill: ReturnType<typeof vi.fn>;
		on: ReturnType<typeof vi.fn>;
		emit: ReturnType<typeof vi.fn>;
	}> = {},
) {
	const mockProcess = Object.assign(new EventEmitter(), {
		stdout: new EventEmitter(),
		stderr: new EventEmitter(),
		stdin: new EventEmitter(),
		pid: 12345,
		kill: vi.fn(),
		...overrides,
	});
	return mockProcess;
}

/**
 * Create a mock WebSocket for testing
 */
export function createMockWebSocket(
	overrides: Partial<{
		close: ReturnType<typeof vi.fn>;
		send: ReturnType<typeof vi.fn>;
		on: ReturnType<typeof vi.fn>;
		emit: ReturnType<typeof vi.fn>;
		readyState: number;
		binaryType?: string;
	}> = {},
) {
	const mockSocket = Object.assign(new EventEmitter(), {
		close: vi.fn(),
		send: vi.fn(),
		readyState: 1, // WebSocket.OPEN
		binaryType: "nodebuffer",
		...overrides,
	});
	return mockSocket;
}

/**
 * Create a mock extension context
 */
export function createMockExtensionContext(
	overrides: Partial<vscode.ExtensionContext> = {},
): vscode.ExtensionContext {
	return {
		subscriptions: [],
		workspaceState: {
			get: vi.fn(),
			update: vi.fn(),
			keys: vi.fn().mockReturnValue([]),
		},
		globalState: {
			get: vi.fn(),
			update: vi.fn(),
			keys: vi.fn().mockReturnValue([]),
			setKeysForSync: vi.fn(),
		},
		secrets: {
			get: vi.fn(),
			store: vi.fn(),
			delete: vi.fn(),
			onDidChange: vi.fn(),
		},
		extensionPath: "/path/to/extension",
		extensionUri: { scheme: "file", path: "/path/to/extension" } as vscode.Uri,
		environmentVariableCollection: {
			persistent: true,
			description: "",
			replace: vi.fn(),
			append: vi.fn(),
			prepend: vi.fn(),
			get: vi.fn(),
			forEach: vi.fn(),
			delete: vi.fn(),
			clear: vi.fn(),
			getScoped: vi.fn(),
		},
		asAbsolutePath: vi.fn(
			(relativePath) => `/path/to/extension/${relativePath}`,
		),
		storageUri: { scheme: "file", path: "/path/to/storage" } as vscode.Uri,
		globalStorageUri: {
			scheme: "file",
			path: "/path/to/global/storage",
		} as vscode.Uri,
		logUri: { scheme: "file", path: "/path/to/logs" } as vscode.Uri,
		extensionMode: 3, // ExtensionMode.Test
		extension: {
			id: "coder.coder-remote",
			extensionUri: {
				scheme: "file",
				path: "/path/to/extension",
			} as vscode.Uri,
			extensionPath: "/path/to/extension",
			isActive: true,
			packageJSON: {},
			exports: undefined,
			activate: vi.fn(),
		},
		...overrides,
	} as vscode.ExtensionContext;
}

// ============================================================================
// Storage Mock Variants
// ============================================================================

/**
 * Create a mock Storage with authentication defaults
 */
export function createMockStorageWithAuth(
	overrides: Partial<Parameters<typeof createMockStorage>[0]> = {},
): Storage {
	return createMockStorage({
		getUrl: vi.fn().mockReturnValue("https://test.coder.com"),
		fetchBinary: vi.fn().mockResolvedValue("/path/to/coder"),
		getSessionTokenPath: vi.fn().mockReturnValue("/path/to/token"),
		getSessionToken: vi.fn().mockResolvedValue("test-token-123"),
		...overrides,
	});
}

/**
 * Create a minimal mock Storage for simple tests
 */
export function createMockStorageMinimal(): Storage {
	return {} as Storage;
}

// ============================================================================
// Workspace Mock Variants
// ============================================================================

/**
 * Create a mock Workspace with running status
 */
export function createMockWorkspaceRunning(
	overrides: Partial<Workspace> = {},
): Workspace {
	return createMockWorkspace({
		latest_build: {
			...createMockWorkspace().latest_build,
			status: "running",
		},
		...overrides,
	});
}

/**
 * Create a mock Workspace with stopped status
 */
export function createMockWorkspaceStopped(
	overrides: Partial<Workspace> = {},
): Workspace {
	return createMockWorkspace({
		latest_build: {
			...createMockWorkspace().latest_build,
			status: "stopped",
		},
		...overrides,
	});
}

/**
 * Create a mock Workspace with failed status
 */
export function createMockWorkspaceFailed(
	overrides: Partial<Workspace> = {},
): Workspace {
	return createMockWorkspace({
		latest_build: {
			...createMockWorkspace().latest_build,
			status: "failed",
		},
		...overrides,
	});
}

/**
 * Create a mock Workspace with a specific build
 */
export function createMockWorkspaceWithBuild(
	build: Partial<WorkspaceBuild>,
	overrides: Partial<Workspace> = {},
): Workspace {
	return createMockWorkspace({
		latest_build: {
			...createMockWorkspace().latest_build,
			...build,
		},
		...overrides,
	});
}

// ============================================================================
// Build Mock Factory
// ============================================================================

/**
 * Create a mock WorkspaceBuild
 */
export function createMockBuild(
	overrides: Partial<WorkspaceBuild> = {},
): WorkspaceBuild {
	return {
		id: "build-id",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		workspace_id: "workspace-id",
		workspace_name: "workspace",
		workspace_owner_id: "owner-id",
		workspace_owner_name: "owner",
		workspace_owner_avatar_url: "",
		template_version_id: "version-id",
		template_version_name: "v1.0.0",
		build_number: 1,
		transition: "start",
		initiator_id: "initiator-id",
		initiator_name: "initiator",
		job: {
			id: "job-id",
			created_at: new Date().toISOString(),
			started_at: new Date().toISOString(),
			completed_at: new Date().toISOString(),
			status: "succeeded",
			worker_id: "",
			file_id: "file-id",
			tags: {},
			error: "",
			error_code: "",
		},
		reason: "initiator",
		resources: [],
		deadline: new Date().toISOString(),
		status: "running",
		daily_cost: 0,
		...overrides,
	} as WorkspaceBuild;
}

// ============================================================================
// VSCode Mock Components
// ============================================================================

/**
 * Create a mock Remote SSH Extension
 */
export function createMockRemoteSSHExtension(
	overrides: Partial<vscode.Extension<unknown>> = {},
): vscode.Extension<unknown> {
	return {
		id: "ms-vscode-remote.remote-ssh",
		extensionUri: {
			scheme: "file",
			path: "/path/to/remote-ssh",
		} as vscode.Uri,
		extensionPath: "/path/to/remote-ssh",
		isActive: true,
		packageJSON: {},
		exports: {
			getSSHConfigPath: vi.fn().mockReturnValue("/path/to/ssh/config"),
		},
		activate: vi.fn(),
		...overrides,
	} as vscode.Extension<unknown>;
}

/**
 * Create a mock TreeView
 */
export function createMockTreeView<T>(
	overrides: Partial<vscode.TreeView<T>> = {},
): vscode.TreeView<T> {
	const mockEventEmitter = {
		fire: vi.fn(),
		event: vi.fn(),
		dispose: vi.fn(),
	};

	return {
		visible: true,
		onDidChangeVisibility: mockEventEmitter.event,
		onDidChangeSelection: mockEventEmitter.event,
		onDidExpandElement: mockEventEmitter.event,
		onDidCollapseElement: mockEventEmitter.event,
		selection: [],
		reveal: vi.fn(),
		dispose: vi.fn(),
		...overrides,
	} as vscode.TreeView<T>;
}

/**
 * Create a mock StatusBarItem
 */
export function createMockStatusBarItem(
	overrides: Partial<vscode.StatusBarItem> = {},
): vscode.StatusBarItem {
	return {
		alignment: 1,
		priority: 100,
		text: "",
		tooltip: undefined,
		color: undefined,
		backgroundColor: undefined,
		command: undefined,
		accessibilityInformation: undefined,
		show: vi.fn(),
		hide: vi.fn(),
		dispose: vi.fn(),
		...overrides,
	} as vscode.StatusBarItem;
}

/**
 * Create a mock QuickPick
 */
export function createMockQuickPick<T extends vscode.QuickPickItem>(
	overrides: Partial<vscode.QuickPick<T>> = {},
): vscode.QuickPick<T> {
	const mockEventEmitter = {
		fire: vi.fn(),
		event: vi.fn(),
		dispose: vi.fn(),
	};

	return {
		items: [],
		placeholder: "",
		value: "",
		busy: false,
		enabled: true,
		title: undefined,
		step: undefined,
		totalSteps: undefined,
		canSelectMany: false,
		matchOnDescription: false,
		matchOnDetail: false,
		activeItems: [],
		selectedItems: [],
		buttons: [],
		onDidChangeValue: mockEventEmitter.event,
		onDidAccept: mockEventEmitter.event,
		onDidChangeActive: mockEventEmitter.event,
		onDidChangeSelection: mockEventEmitter.event,
		onDidHide: mockEventEmitter.event,
		onDidTriggerButton: mockEventEmitter.event,
		onDidTriggerItemButton: mockEventEmitter.event,
		show: vi.fn(),
		hide: vi.fn(),
		dispose: vi.fn(),
		...overrides,
	} as vscode.QuickPick<T>;
}

/**
 * Create a mock Terminal
 */
export function createMockTerminal(
	overrides: Partial<vscode.Terminal> = {},
): vscode.Terminal {
	return {
		name: "Mock Terminal",
		processId: Promise.resolve(12345),
		creationOptions: {},
		exitStatus: undefined,
		state: { isInteractedWith: false },
		sendText: vi.fn(),
		show: vi.fn(),
		hide: vi.fn(),
		dispose: vi.fn(),
		...overrides,
	} as vscode.Terminal;
}

/**
 * Create a mock OutputChannel
 */
export function createMockOutputChannel(
	overrides: Partial<vscode.OutputChannel> = {},
): vscode.OutputChannel {
	return {
		name: "Mock Output",
		append: vi.fn(),
		appendLine: vi.fn(),
		clear: vi.fn(),
		show: vi.fn(),
		hide: vi.fn(),
		dispose: vi.fn(),
		replace: vi.fn(),
		...overrides,
	} as vscode.OutputChannel;
}

// ============================================================================
// Provider Mock Factories
// ============================================================================

/**
 * Create a mock WorkspaceProvider
 */
export function createMockWorkspaceProvider(
	overrides: Partial<WorkspaceProvider> = {},
): WorkspaceProvider {
	const mockEventEmitter = {
		fire: vi.fn(),
		event: vi.fn(),
		dispose: vi.fn(),
	};

	return {
		onDidChangeTreeData: mockEventEmitter.event,
		getTreeItem: vi.fn((item) => item),
		getChildren: vi.fn().mockResolvedValue([]),
		refresh: vi.fn(),
		fetchAndRefresh: vi.fn().mockResolvedValue(undefined),
		setVisibility: vi.fn(),
		...overrides,
	} as unknown as WorkspaceProvider;
}

/**
 * Create a generic TreeDataProvider mock
 */
export function createMockTreeDataProvider<T>(
	overrides: Partial<vscode.TreeDataProvider<T>> = {},
): vscode.TreeDataProvider<T> {
	const mockEventEmitter = {
		fire: vi.fn(),
		event: vi.fn(),
		dispose: vi.fn(),
	};

	return {
		onDidChangeTreeData: mockEventEmitter.event,
		getTreeItem: vi.fn((item) => item as vscode.TreeItem),
		getChildren: vi.fn().mockResolvedValue([]),
		getParent: vi.fn(),
		resolveTreeItem: vi.fn(),
		...overrides,
	} as vscode.TreeDataProvider<T>;
}

// ============================================================================
// Remote Mock Factory
// ============================================================================

/**
 * Create a mock Remote instance
 */
export function createMockRemote(overrides: Partial<Remote> = {}): Remote {
	return {
		setup: vi.fn().mockResolvedValue({
			url: "https://test.coder.com",
			token: "test-token-123",
		}),
		closeRemote: vi.fn().mockResolvedValue(undefined),
		...overrides,
	} as unknown as Remote;
}

// ============================================================================
// Commands Mock Factory
// ============================================================================

/**
 * Create a mock Commands instance
 */
export function createMockCommands(
	overrides: Partial<Commands> = {},
): Commands {
	return {
		login: vi.fn().mockResolvedValue(undefined),
		logout: vi.fn().mockResolvedValue(undefined),
		openInBrowser: vi.fn().mockResolvedValue(undefined),
		openInTerminal: vi.fn().mockResolvedValue(undefined),
		openViaSSH: vi.fn().mockResolvedValue(undefined),
		viewWorkspaceInBrowser: vi.fn().mockResolvedValue(undefined),
		open: vi.fn().mockResolvedValue(undefined),
		openDevContainer: vi.fn().mockResolvedValue(undefined),
		openFromSidebar: vi.fn().mockResolvedValue(undefined),
		openAppStatus: vi.fn().mockResolvedValue(undefined),
		updateWorkspace: vi.fn().mockResolvedValue(undefined),
		createWorkspace: vi.fn().mockResolvedValue(undefined),
		navigateToWorkspace: vi.fn().mockResolvedValue(undefined),
		navigateToWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
		viewLogs: vi.fn().mockResolvedValue(undefined),
		...overrides,
	} as unknown as Commands;
}

// ============================================================================
// EventEmitter Mock Factory
// ============================================================================

/**
 * Create a mock vscode.EventEmitter
 */
export function createMockEventEmitter<T>(): vscode.EventEmitter<T> {
	return {
		fire: vi.fn(),
		event: vi.fn(),
		dispose: vi.fn(),
	} as unknown as vscode.EventEmitter<T>;
}

// ============================================================================
// HTTP/Network Mock Factories
// ============================================================================

/**
 * Create a mock Axios instance
 */
export function createMockAxiosInstance(
	overrides: Partial<{
		defaults: {
			baseURL?: string;
			headers?: Record<string, unknown>;
		};
		interceptors?: {
			request?: { use: ReturnType<typeof vi.fn> };
			response?: { use: ReturnType<typeof vi.fn> };
		};
	}> = {},
) {
	return {
		defaults: {
			baseURL: "https://test.coder.com",
			headers: { common: {} },
			...overrides.defaults,
		},
		interceptors: {
			request: { use: vi.fn() },
			response: { use: vi.fn() },
			...overrides.interceptors,
		},
		request: vi.fn().mockResolvedValue({ data: {} }),
		get: vi.fn().mockResolvedValue({ data: {} }),
		post: vi.fn().mockResolvedValue({ data: {} }),
		put: vi.fn().mockResolvedValue({ data: {} }),
		delete: vi.fn().mockResolvedValue({ data: {} }),
	};
}

/**
 * Create a mock ProxyAgent
 */
export function createMockProxyAgent(
	overrides: Partial<ProxyAgent> = {},
): ProxyAgent {
	return {
		...overrides,
	} as ProxyAgent;
}

// ============================================================================
// File System Mock Helpers
// ============================================================================

/**
 * Create a mock vscode.Uri
 */
export function createMockUri(
	path: string,
	scheme: string = "file",
): vscode.Uri {
	return {
		scheme,
		path,
		fsPath: path,
		authority: "",
		query: "",
		fragment: "",
		with: vi.fn(),
		toString: vi.fn(() => `${scheme}://${path}`),
		toJSON: vi.fn(() => ({ scheme, path })),
	} as unknown as vscode.Uri;
}

/**
 * Create a mock file system watcher
 */
export function createMockFileSystemWatcher(
	overrides: Partial<vscode.FileSystemWatcher> = {},
): vscode.FileSystemWatcher {
	const mockEventEmitter = {
		fire: vi.fn(),
		event: vi.fn(),
		dispose: vi.fn(),
	};

	return {
		ignoreCreateEvents: false,
		ignoreChangeEvents: false,
		ignoreDeleteEvents: false,
		onDidCreate: mockEventEmitter.event,
		onDidChange: mockEventEmitter.event,
		onDidDelete: mockEventEmitter.event,
		dispose: vi.fn(),
		...overrides,
	} as vscode.FileSystemWatcher;
}
