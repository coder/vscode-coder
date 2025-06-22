import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";
import { vi } from "vitest";
import type * as vscode from "vscode";
import type { Storage } from "./storage";

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
 * Create a partial mock Storage with only the methods needed
 */
export function createMockStorage(
	overrides: Partial<{
		getHeaders: ReturnType<typeof vi.fn>;
		writeToCoderOutputChannel: ReturnType<typeof vi.fn>;
	}> = {},
): Partial<Storage> {
	return {
		getHeaders: overrides.getHeaders ?? vi.fn().mockResolvedValue({}),
		writeToCoderOutputChannel: overrides.writeToCoderOutputChannel ?? vi.fn(),
		...overrides,
	};
}
