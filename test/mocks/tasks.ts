/**
 * Test factories for Tasks-related types.
 * Use these to create test data with sensible defaults.
 */

import type {
	Task,
	TaskLogEntry,
	Template,
	Preset,
	TaskState,
} from "coder/site/src/api/typesGenerated";

import type { TaskTemplate } from "@repo/shared";

/**
 * Create a Task with sensible defaults.
 * The defaults represent a typical active task with a running workspace.
 */
export function task(overrides: Partial<Task> = {}): Task {
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

/**
 * Create a Task without workspace or state details.
 * Useful for testing state/status logic in isolation.
 */
export function minimalTask(overrides: Partial<Task> = {}): Task {
	return task({
		workspace_id: null,
		workspace_name: "",
		workspace_status: undefined,
		workspace_build_number: undefined,
		current_state: null,
		...overrides,
	});
}

/** Create a task state object for testing state-dependent behavior */
export function taskState(state: TaskState): Task["current_state"] {
	return { state, message: "", timestamp: "", uri: "" };
}

/** Create a Template with sensible defaults */
export function template(overrides: Partial<Template> = {}): Template {
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
		disable_module_cache: false,
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

/** Create a Preset with sensible defaults */
export function preset(overrides: Partial<Preset> = {}): Preset {
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

/** Create a TaskLogEntry with sensible defaults */
export function logEntry(overrides: Partial<TaskLogEntry> = {}): TaskLogEntry {
	return {
		id: 1,
		time: "2024-01-01T00:00:00Z",
		type: "output",
		content: "Test log entry",
		...overrides,
	};
}

/** Create a TaskTemplate with sensible defaults */
export function taskTemplate(
	overrides: Partial<TaskTemplate> = {},
): TaskTemplate {
	return {
		id: "template-1",
		name: "test-template",
		displayName: "Test Template",
		icon: "/icon.svg",
		activeVersionId: "version-1",
		presets: [],
		...overrides,
	};
}
