import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusIndicator } from "@repo/tasks/components";

import { minimalTask, task, taskState } from "../../mocks/tasks";

import type { Task } from "@repo/shared";

describe("StatusIndicator", () => {
	interface StatusTestCase {
		name: string;
		task: Task;
		title: string;
	}
	it.each<StatusTestCase>([
		{
			name: "error task status",
			task: task({ status: "error", current_state: null }),
			title: "Error",
		},
		{
			name: "failed task state",
			task: task({ current_state: taskState("failed") }),
			title: "Error",
		},
		{
			name: "stopped workspace",
			task: task({ workspace_status: "stopped", current_state: null }),
			title: "Paused",
		},
		{
			name: "pending workspace",
			task: task({ workspace_status: "pending", current_state: null }),
			title: "Initializing",
		},
		{
			name: "working state",
			task: task({ current_state: taskState("working") }),
			title: "Working",
		},
		{
			name: "complete state",
			task: task({ current_state: taskState("complete") }),
			title: "Complete",
		},
		{
			name: "no workspace or state (idle)",
			task: minimalTask(),
			title: "Idle",
		},
	])("$name", ({ task, title }) => {
		render(<StatusIndicator task={task} />);
		const dot = screen.getByTitle(title);
		expect(dot.classList).toContain(title.toLowerCase());
	});
});
