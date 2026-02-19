import { describe, expect, it } from "vitest";

import {
	getTaskPermissions,
	isAgentStarting,
	isBuildingWorkspace,
	isStableTask,
	isTaskWorking,
	type Task,
	type TaskPermissions,
} from "@repo/shared";

import {
	minimalTask as task,
	task as fullTask,
	taskState as state,
} from "../../../mocks/tasks";

import type {
	WorkspaceAgentLifecycle,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

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
			expected: {
				canPause: false,
				pauseDisabled: false,
				canResume: false,
				canSendMessage: true,
			},
		},
		{
			name: "active task",
			overrides: { workspace_id: "ws", status: "active" },
			expected: {
				canPause: true,
				pauseDisabled: false,
				canResume: false,
				canSendMessage: true,
			},
		},
		{
			name: "paused task",
			overrides: { workspace_id: "ws", status: "paused" },
			expected: {
				canPause: false,
				pauseDisabled: false,
				canResume: true,
				canSendMessage: false,
			},
		},
		{
			name: "error task (both actions available)",
			overrides: { workspace_id: "ws", status: "error" },
			expected: {
				canPause: true,
				pauseDisabled: false,
				canResume: true,
				canSendMessage: false,
			},
		},
		{
			name: "unknown task (both actions available)",
			overrides: { workspace_id: "ws", status: "unknown" },
			expected: {
				canPause: true,
				pauseDisabled: false,
				canResume: true,
				canSendMessage: false,
			},
		},
		{
			name: "initializing task (pause disabled)",
			overrides: { workspace_id: "ws", status: "initializing" },
			expected: {
				canPause: true,
				pauseDisabled: true,
				canResume: false,
				canSendMessage: false,
			},
		},
		{
			name: "pending task (pause disabled)",
			overrides: { workspace_id: "ws", status: "pending" },
			expected: {
				canPause: true,
				pauseDisabled: true,
				canResume: false,
				canSendMessage: false,
			},
		},
		{
			name: "no workspace ignores task status",
			overrides: { workspace_id: null, status: "active" },
			expected: {
				canPause: false,
				pauseDisabled: false,
				canResume: false,
				canSendMessage: true,
			},
		},
	])("$name", ({ overrides, expected }) => {
		expect(getTaskPermissions(task(overrides))).toEqual(expected);
	});
});

interface BooleanTestCase {
	name: string;
	overrides: Partial<Task>;
	expected: boolean;
}

describe("isTaskWorking", () => {
	it.each<BooleanTestCase>([
		{
			name: "active with working state",
			overrides: { status: "active", current_state: state("working") },
			expected: true,
		},
		{
			name: "active with non-working state",
			overrides: { status: "active", current_state: state("complete") },
			expected: false,
		},
		{
			name: "active with null current_state",
			overrides: { status: "active", current_state: null },
			expected: false,
		},
		{
			name: "non-active with working state",
			overrides: { status: "paused", current_state: state("working") },
			expected: false,
		},
	])("$name → $expected", ({ overrides, expected }) => {
		expect(isTaskWorking(fullTask(overrides))).toBe(expected);
	});
});

describe("isStableTask", () => {
	it.each<BooleanTestCase>([
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
			name: "active with null current_state",
			overrides: { status: "active", current_state: null },
			expected: false,
		},
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

describe("isBuildingWorkspace", () => {
	interface BuildingTestCase {
		ws: WorkspaceStatus;
		expected: boolean;
	}
	it.each<BuildingTestCase>([
		{ ws: "pending", expected: true },
		{ ws: "starting", expected: true },
		{ ws: "stopping", expected: false },
		{ ws: "running", expected: false },
		{ ws: "stopped", expected: false },
	])("workspace_status=$ws → $expected", ({ ws, expected }) => {
		expect(isBuildingWorkspace(task({ workspace_status: ws }))).toBe(expected);
	});
});

describe("isAgentStarting", () => {
	interface AgentStartingTestCase {
		ws: WorkspaceStatus;
		lc: WorkspaceAgentLifecycle | null;
		expected: boolean;
	}
	it.each<AgentStartingTestCase>([
		{ ws: "running", lc: "created", expected: true },
		{ ws: "running", lc: "starting", expected: true },
		{ ws: "running", lc: "ready", expected: false },
		{ ws: "running", lc: null, expected: false },
		{ ws: "starting", lc: "created", expected: false },
	])("ws=$ws lc=$lc → $expected", ({ ws, lc, expected }) => {
		expect(
			isAgentStarting(
				task({ workspace_status: ws, workspace_agent_lifecycle: lc }),
			),
		).toBe(expected);
	});
});
