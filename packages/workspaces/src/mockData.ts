import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceAgentMetadata,
	WorkspaceApp,
	WorkspaceAppStatus,
	WorkspaceBuild,
} from "coder/site/src/api/typesGenerated";

/** A workspace with its agents and per-agent metadata for the prototype. */
export interface MockWorkspaceEntry {
	readonly workspace: Workspace;
	readonly agents: readonly WorkspaceAgent[];
	readonly metadata: ReadonlyMap<string, readonly WorkspaceAgentMetadata[]>;
	readonly owner: "me" | "other";
	readonly shared: boolean;
}

/* Local fixtures instead of @repo/mocks: the mocks package is restricted to
   tests and stories, and the panel only needs a few fixed objects. */

const mockBuild = (
	overrides: Partial<WorkspaceBuild> = {},
): WorkspaceBuild => ({
	id: "build-1",
	created_at: "2026-08-01T00:00:00Z",
	updated_at: "2026-08-01T00:00:00Z",
	workspace_id: "workspace-1",
	workspace_name: "dev",
	workspace_owner_id: "owner-1",
	workspace_owner_name: "testuser",
	template_version_id: "version-1",
	template_version_name: "v1",
	build_number: 1,
	transition: "start",
	initiator_id: "owner-1",
	initiator_name: "testuser",
	job: {
		id: "job-1",
		created_at: "2026-08-01T00:00:00Z",
		status: "succeeded",
		file_id: "file-1",
		tags: {},
		queue_position: 0,
		queue_size: 0,
		organization_id: "org-1",
		initiator_id: "owner-1",
		input: {},
		type: "workspace_build",
		metadata: {
			template_version_name: "v1",
			template_id: "template-1",
			template_name: "devcontainer",
			template_display_name: "Dev Container",
			template_icon: "/icon.svg",
		},
		logs_overflowed: false,
	},
	reason: "initiator",
	resources: [],
	status: "running",
	daily_cost: 0,
	template_version_preset_id: null,
	...overrides,
});

const mockWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
	id: "workspace-1",
	created_at: "2026-08-01T00:00:00Z",
	updated_at: "2026-08-01T00:00:00Z",
	owner_id: "owner-1",
	owner_name: "testuser",
	owner_avatar_url: "",
	organization_id: "org-1",
	organization_name: "test-org",
	template_id: "template-1",
	template_name: "devcontainer",
	template_display_name: "Dev Container",
	template_icon: "/icon.svg",
	template_allow_user_cancel_workspace_jobs: true,
	template_active_version_id: "version-1",
	template_require_active_version: false,
	template_use_classic_parameter_flow: false,
	latest_build: mockBuild(),
	latest_app_status: null,
	outdated: false,
	name: "dev",
	last_used_at: "2026-08-13T00:00:00Z",
	deleting_at: null,
	dormant_at: null,
	health: { healthy: true, failing_agents: [] },
	automatic_updates: "never",
	allow_renames: false,
	favorite: false,
	next_start_at: null,
	is_prebuild: false,
	...overrides,
});

const mockAgent = (
	overrides: Partial<WorkspaceAgent> = {},
): WorkspaceAgent => ({
	id: "agent-1",
	parent_id: null,
	created_at: "2026-08-01T00:00:00Z",
	updated_at: "2026-08-01T00:00:00Z",
	status: "connected",
	lifecycle_state: "ready",
	name: "main",
	resource_id: "resource-1",
	architecture: "amd64",
	environment_variables: {},
	operating_system: "linux",
	logs_length: 0,
	logs_overflowed: false,
	version: "2.25.0",
	api_version: "1.0",
	apps: [],
	connection_timeout_seconds: 120,
	troubleshooting_url: "",
	subsystems: [],
	health: { healthy: true },
	display_apps: [],
	log_sources: [],
	scripts: [],
	startup_script_behavior: "non-blocking",
	...overrides,
});

const mockApp = (overrides: Partial<WorkspaceApp> = {}): WorkspaceApp => ({
	id: "app-1",
	external: false,
	slug: "app-1",
	subdomain: false,
	sharing_level: "owner",
	health: "healthy",
	hidden: false,
	open_in: "tab",
	statuses: [],
	...overrides,
});

const mockStatus = (
	overrides: Partial<WorkspaceAppStatus> = {},
): WorkspaceAppStatus => ({
	id: "status-1",
	created_at: "2026-08-13T10:00:00Z",
	workspace_id: "workspace-1",
	agent_id: "agent-1",
	app_id: "app-1",
	state: "idle",
	message: "Idle",
	uri: "",
	icon: "",
	needs_user_attention: false,
	...overrides,
});

const mockMetadata = (
	key: string,
	displayName: string,
	value: string,
	collectedAt: string,
): WorkspaceAgentMetadata => ({
	description: {
		display_name: displayName,
		key,
		script: `echo ${value}`,
		interval: 10,
		timeout: 1,
	},
	result: { collected_at: collectedAt, age: 12, value, error: "" },
});

/**
 * Mock deployment data: two own workspaces (one running with app statuses and
 * metadata, one stopped), one shared running workspace, and one workspace from
 * another owner.
 */
export const MOCK_WORKSPACES: readonly MockWorkspaceEntry[] = [
	{
		workspace: mockWorkspace({ id: "workspace-dev", name: "dev" }),
		agents: [
			mockAgent({
				id: "agent-dev",
				apps: [
					mockApp({
						id: "vscode",
						slug: "vscode",
						display_name: "VS Code Desktop",
					}),
					mockApp({
						id: "ci",
						slug: "ci",
						display_name: "CI Watcher",
						statuses: [
							mockStatus({
								id: "status-ci-running",
								app_id: "ci",
								state: "working",
								message: "Building packages/ui",
							}),
							mockStatus({
								id: "status-ci-failed",
								app_id: "ci",
								state: "failure",
								message: "Type check failed in treePolicy.ts",
								needs_user_attention: true,
							}),
						],
					}),
				],
			}),
		],
		metadata: new Map([
			[
				"agent-dev",
				[
					mockMetadata("cpu", "CPU Usage", "23%", "2026-08-13T13:58:00Z"),
					mockMetadata(
						"branch",
						"Git Branch",
						"feat/ui-tree-suite",
						"2026-08-13T13:55:00Z",
					),
				],
			],
		]),
		owner: "me",
		shared: false,
	},
	{
		workspace: mockWorkspace({
			id: "workspace-staging",
			name: "staging",
			template_name: "kubernetes",
			template_display_name: "Kubernetes",
			latest_build: mockBuild({ status: "stopped" }),
		}),
		agents: [
			mockAgent({
				id: "agent-staging",
				status: "disconnected",
				lifecycle_state: "off",
			}),
		],
		metadata: new Map(),
		owner: "me",
		shared: false,
	},
	{
		workspace: mockWorkspace({
			id: "workspace-shared-review",
			name: "code-review",
			owner_id: "owner-2",
			owner_name: "priya",
			shared_with: [],
		}),
		agents: [mockAgent({ id: "agent-review", name: "review" })],
		metadata: new Map(),
		owner: "other",
		shared: true,
	},
	{
		workspace: mockWorkspace({
			id: "workspace-ci-pool",
			name: "ci-pool",
			owner_id: "owner-3",
			owner_name: "marcus",
			template_name: "ci",
			template_display_name: "CI Runner",
		}),
		agents: [mockAgent({ id: "agent-ci", name: "runner" })],
		metadata: new Map(),
		owner: "other",
		shared: false,
	},
];
