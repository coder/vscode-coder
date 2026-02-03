import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
	ErrorState,
	StatusIndicator,
	TaskItem,
	TaskList,
} from "../../../packages/tasks/src/components";

import type { Task } from "@repo/shared";

vi.stubGlobal(
	"acquireVsCodeApi",
	vi.fn(() => ({
		postMessage: vi.fn(),
		getState: vi.fn(),
		setState: vi.fn(),
	})),
);

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

describe("StatusIndicator", () => {
	it("renders with active status", () => {
		const { container } = render(
			<StatusIndicator status="active" state={null} />,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		expect(dot?.classList.contains("running")).toBe(true);
	});

	it("renders with error status", () => {
		const { container } = render(
			<StatusIndicator status="error" state={null} />,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		expect(dot?.classList.contains("error")).toBe(true);
	});

	it("renders with paused status", () => {
		const { container } = render(
			<StatusIndicator status="paused" state={null} />,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		expect(dot?.classList.contains("paused")).toBe(true);
	});

	it("renders with pending status", () => {
		const { container } = render(
			<StatusIndicator status="pending" state={null} />,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		expect(dot?.classList.contains("initializing")).toBe(true);
	});

	it("uses task state over task status when available", () => {
		const { container } = render(
			<StatusIndicator status="active" state="complete" />,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		expect(dot?.classList.contains("ready")).toBe(true);
	});

	it("renders failed state", () => {
		const { container } = render(
			<StatusIndicator status="active" state="failed" />,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		// Failed maps to error class
		expect(dot?.classList.contains("error")).toBe(true);
	});
});

describe("ErrorState", () => {
	it("renders error message", () => {
		render(<ErrorState message="Something went wrong" onRetry={vi.fn()} />);

		expect(screen.getByText("Something went wrong")).toBeTruthy();
	});

	it("calls onRetry when button is clicked", () => {
		const onRetry = vi.fn();
		render(<ErrorState message="Error" onRetry={onRetry} />);

		fireEvent.click(screen.getByText("Retry"));
		expect(onRetry).toHaveBeenCalled();
	});
});

describe("TaskItem", () => {
	const onSelect = vi.fn();

	it("renders task name", () => {
		const task = createMockTask({ display_name: "My Task" });
		render(<TaskItem task={task} onSelect={onSelect} />);

		expect(screen.getByText("My Task")).toBeTruthy();
	});

	it("renders status indicator", () => {
		const task = createMockTask();
		const { container } = render(<TaskItem task={task} onSelect={onSelect} />);

		expect(container.querySelector(".status-dot")).toBeTruthy();
	});

	it("renders action menu", () => {
		const task = createMockTask();
		const { container } = render(<TaskItem task={task} onSelect={onSelect} />);

		expect(container.querySelector(".action-menu")).toBeTruthy();
	});

	it("uses task.name as fallback when display_name is empty", () => {
		const task = createMockTask({
			display_name: "",
			name: "fallback-name",
		});
		render(<TaskItem task={task} onSelect={onSelect} />);

		expect(screen.getByText("fallback-name")).toBeTruthy();
	});
});

describe("TaskList", () => {
	const onSelectTask = vi.fn();

	it("renders empty state when no tasks", () => {
		render(<TaskList tasks={[]} onSelectTask={onSelectTask} />);

		expect(screen.getByText("No tasks yet")).toBeTruthy();
	});

	it("renders task list", () => {
		const tasks = [
			createMockTask({ id: "task-1", display_name: "Task 1" }),
			createMockTask({ id: "task-2", display_name: "Task 2" }),
		];
		render(<TaskList tasks={tasks} onSelectTask={onSelectTask} />);

		expect(screen.getByText("Task 1")).toBeTruthy();
		expect(screen.getByText("Task 2")).toBeTruthy();
	});
});
