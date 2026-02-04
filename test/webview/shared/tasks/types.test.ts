import { describe, expect, it } from "vitest";

import {
	getTaskActions,
	getTaskUIState,
	type Task,
	type TaskActions,
	type TaskState,
	type TaskUIState,
} from "@repo/shared";

// Minimal task factory
function task(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		name: "test",
		display_name: "Test",
		initial_prompt: "",
		status: "active",
		template_id: "t1",
		template_version_id: "v1",
		template_name: "tmpl",
		template_display_name: "Template",
		template_icon: "",
		organization_id: "org-1",
		owner_id: "user-1",
		owner_name: "user",
		created_at: "",
		updated_at: "",
		workspace_id: null,
		workspace_status: undefined,
		workspace_name: "",
		workspace_agent_id: null,
		workspace_agent_lifecycle: null,
		workspace_agent_health: null,
		workspace_app_id: null,
		current_state: null,
		...overrides,
	} as Task;
}

function state(s: TaskState): Task["current_state"] {
	return { state: s, message: "", timestamp: "", uri: "" };
}

describe("getTaskActions", () => {
	interface TaskActionsTestCase {
		name: string;
		overrides: Partial<Task>;
		expected: TaskActions;
	}
	it.each<TaskActionsTestCase>([
		{
			name: "no workspace",
			overrides: {},
			expected: { canPause: false, canResume: false },
		},
		{
			name: "running workspace",
			overrides: { workspace_id: "ws", workspace_status: "running" },
			expected: { canPause: true, canResume: false },
		},
		{
			name: "stopped workspace",
			overrides: { workspace_id: "ws", workspace_status: "stopped" },
			expected: { canPause: false, canResume: true },
		},
		{
			name: "failed workspace",
			overrides: { workspace_id: "ws", workspace_status: "failed" },
			expected: { canPause: false, canResume: true },
		},
		{
			name: "canceled workspace",
			overrides: { workspace_id: "ws", workspace_status: "canceled" },
			expected: { canPause: false, canResume: true },
		},
		{
			name: "starting workspace",
			overrides: { workspace_id: "ws", workspace_status: "starting" },
			expected: { canPause: false, canResume: false },
		},
		{
			name: "pending workspace",
			overrides: { workspace_id: "ws", workspace_status: "pending" },
			expected: { canPause: false, canResume: false },
		},
		{
			name: "workspace_id null with running status",
			overrides: { workspace_id: null, workspace_status: "running" },
			expected: { canPause: false, canResume: false },
		},
	])("$name", ({ overrides, expected }) => {
		expect(getTaskActions(task(overrides))).toEqual(expected);
	});
});

describe("getTaskUIState", () => {
	interface TaskUIStateTestCase {
		name: string;
		overrides: Partial<Task>;
		expected: TaskUIState;
	}
	it.each<TaskUIStateTestCase>([
		// Error states (highest priority)
		{
			name: "task status error",
			overrides: { status: "error" },
			expected: "error",
		},
		{
			name: "task state failed",
			overrides: { current_state: state("failed") },
			expected: "error",
		},
		{
			name: "error takes priority over paused",
			overrides: { status: "error", workspace_status: "stopped" },
			expected: "error",
		},

		// Paused states
		{
			name: "stopped workspace",
			overrides: { workspace_status: "stopped" },
			expected: "paused",
		},
		{
			name: "stopping workspace",
			overrides: { workspace_status: "stopping" },
			expected: "paused",
		},
		{
			name: "canceled workspace",
			overrides: { workspace_status: "canceled" },
			expected: "paused",
		},

		// Initializing states
		{
			name: "starting workspace",
			overrides: { workspace_status: "starting" },
			expected: "initializing",
		},
		{
			name: "pending workspace",
			overrides: { workspace_status: "pending" },
			expected: "initializing",
		},

		// Active states (status=active, workspace=running, has state)
		{
			name: "working state",
			overrides: {
				status: "active",
				workspace_status: "running",
				current_state: state("working"),
			},
			expected: "working",
		},
		{
			name: "idle state",
			overrides: {
				status: "active",
				workspace_status: "running",
				current_state: state("idle"),
			},
			expected: "idle",
		},

		// Complete state
		{
			name: "complete state",
			overrides: { current_state: state("complete") },
			expected: "complete",
		},

		// Default fallback
		{ name: "no workspace or state", overrides: {}, expected: "idle" },
		{
			name: "running but no state",
			overrides: { workspace_status: "running", current_state: null },
			expected: "idle",
		},
	])("$name → $expected", ({ overrides, expected }) => {
		expect(getTaskUIState(task(overrides))).toBe(expected);
	});
});
