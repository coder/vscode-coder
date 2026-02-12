import { describe, expect, it } from "vitest";

import {
	getTaskPermissions,
	isStableTask,
	type Task,
	type TaskPermissions,
} from "@repo/shared";

import {
	minimalTask as task,
	task as fullTask,
	taskState as state,
} from "../../../mocks/tasks";

describe("getTaskPermissions", () => {
	interface TaskPermissionsTestCase {
		name: string;
		overrides: Partial<Task>;
		expected: TaskPermissions;
	}
	it.each<TaskPermissionsTestCase>([
		{
			name: "no workspace",
			overrides: {},
			expected: { canPause: false, pauseDisabled: false, canResume: false },
		},
		{
			name: "active task",
			overrides: { workspace_id: "ws", status: "active" },
			expected: { canPause: true, pauseDisabled: false, canResume: false },
		},
		{
			name: "paused task",
			overrides: { workspace_id: "ws", status: "paused" },
			expected: { canPause: false, pauseDisabled: false, canResume: true },
		},
		{
			name: "error task (both actions available)",
			overrides: { workspace_id: "ws", status: "error" },
			expected: { canPause: true, pauseDisabled: false, canResume: true },
		},
		{
			name: "unknown task (both actions available)",
			overrides: { workspace_id: "ws", status: "unknown" },
			expected: { canPause: true, pauseDisabled: false, canResume: true },
		},
		{
			name: "initializing task (pause disabled)",
			overrides: { workspace_id: "ws", status: "initializing" },
			expected: { canPause: true, pauseDisabled: true, canResume: false },
		},
		{
			name: "pending task (pause disabled)",
			overrides: { workspace_id: "ws", status: "pending" },
			expected: { canPause: true, pauseDisabled: true, canResume: false },
		},
		{
			name: "no workspace ignores task status",
			overrides: { workspace_id: null, status: "active" },
			expected: { canPause: false, pauseDisabled: false, canResume: false },
		},
	])("$name", ({ overrides, expected }) => {
		expect(getTaskPermissions(task(overrides))).toEqual(expected);
	});
});

describe("isStableTask", () => {
	it.each<{ name: string; overrides: Partial<Task>; expected: boolean }>([
		{ name: "error status", overrides: { status: "error" }, expected: true },
		{ name: "paused status", overrides: { status: "paused" }, expected: true },
		{
			name: "complete state",
			overrides: { current_state: state("complete") },
			expected: true,
		},
		{
			name: "failed state",
			overrides: { current_state: state("failed") },
			expected: true,
		},
		{
			name: "idle state",
			overrides: { current_state: state("idle") },
			expected: true,
		},
		{
			name: "working state",
			overrides: { current_state: state("working") },
			expected: false,
		},
		{ name: "active status", overrides: { status: "active" }, expected: false },
		{
			name: "active with working state",
			overrides: { status: "active", current_state: state("working") },
			expected: false,
		},
		{
			name: "initializing status",
			overrides: { status: "initializing" },
			expected: false,
		},
		{
			name: "pending status",
			overrides: { status: "pending" },
			expected: false,
		},
		{
			name: "unknown status",
			overrides: { status: "unknown" },
			expected: false,
		},
	])("$name → $expected", ({ overrides, expected }) => {
		expect(isStableTask(fullTask(overrides))).toBe(expected);
	});
});
