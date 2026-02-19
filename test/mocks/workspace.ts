/**
 * Test factory for Coder SDK Workspace type.
 */

import type {
	Workspace,
	WorkspaceBuild,
} from "coder/site/src/api/typesGenerated";

const defaultBuild: WorkspaceBuild = {
	id: "build-1",
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
	workspace_id: "workspace-1",
	workspace_name: "test-workspace",
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
		created_at: "2024-01-01T00:00:00Z",
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
			template_name: "test-template",
			template_display_name: "Test Template",
			template_icon: "/icon.svg",
		},
		logs_overflowed: false,
	},
	reason: "initiator",
	resources: [],
	status: "running",
	daily_cost: 0,
	template_version_preset_id: null,
};

/** Create a Workspace with sensible defaults for a running task workspace. */
export function workspace(
	overrides: Omit<Partial<Workspace>, "latest_build"> & {
		latest_build?: Partial<WorkspaceBuild>;
	} = {},
): Workspace {
	const { latest_build: buildOverrides, ...rest } = overrides;
	return {
		id: "workspace-1",
		created_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
		owner_id: "owner-1",
		owner_name: "testuser",
		owner_avatar_url: "",
		organization_id: "org-1",
		organization_name: "test-org",
		template_id: "template-1",
		template_name: "test-template",
		template_display_name: "Test Template",
		template_icon: "/icon.svg",
		template_allow_user_cancel_workspace_jobs: true,
		template_active_version_id: "version-1",
		template_require_active_version: false,
		template_use_classic_parameter_flow: false,
		latest_build: { ...defaultBuild, ...buildOverrides },
		latest_app_status: null,
		outdated: false,
		name: "test-workspace",
		last_used_at: "2024-01-01T00:00:00Z",
		deleting_at: null,
		dormant_at: null,
		health: {
			healthy: true,
			failing_agents: [],
		},
		automatic_updates: "never",
		allow_renames: false,
		favorite: false,
		next_start_at: null,
		is_prebuild: false,
		...rest,
	};
}
