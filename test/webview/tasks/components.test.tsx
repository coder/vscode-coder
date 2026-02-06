import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
	ErrorState,
	StatusIndicator,
	TaskItem,
	TaskList,
} from "../../../packages/tasks/src/components";
import { task } from "../../mocks/tasks";

vi.stubGlobal(
	"acquireVsCodeApi",
	vi.fn(() => ({
		postMessage: vi.fn(),
		getState: vi.fn(),
		setState: vi.fn(),
	})),
);

describe("StatusIndicator", () => {
	it("renders with active/working status", () => {
		const { container } = render(
			<StatusIndicator task={task({ status: "active" })} />,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		expect(dot?.classList.contains("running")).toBe(true);
	});

	it("renders with error status", () => {
		const { container } = render(
			<StatusIndicator task={task({ status: "error", current_state: null })} />,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		expect(dot?.classList.contains("error")).toBe(true);
	});

	it("renders with paused workspace", () => {
		const { container } = render(
			<StatusIndicator
				task={task({ workspace_status: "stopped", current_state: null })}
			/>,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		expect(dot?.classList.contains("paused")).toBe(true);
	});

	it("renders with pending status", () => {
		const { container } = render(
			<StatusIndicator
				task={task({ workspace_status: "pending", current_state: null })}
			/>,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		expect(dot?.classList.contains("initializing")).toBe(true);
	});

	it("uses task state when workspace is running", () => {
		const { container } = render(
			<StatusIndicator
				task={task({
					status: "active",
					workspace_status: "running",
					current_state: {
						state: "complete",
						message: "",
						timestamp: "",
						uri: "",
					},
				})}
			/>,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
		expect(dot?.classList.contains("ready")).toBe(true);
	});

	it("renders failed state", () => {
		const { container } = render(
			<StatusIndicator
				task={task({
					current_state: {
						state: "failed",
						message: "",
						timestamp: "",
						uri: "",
					},
				})}
			/>,
		);
		const dot = container.querySelector(".status-dot");
		expect(dot).toBeTruthy();
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
		render(
			<TaskItem task={task({ display_name: "My Task" })} onSelect={onSelect} />,
		);

		expect(screen.getByText("My Task")).toBeTruthy();
	});

	it("renders status indicator", () => {
		const { container } = render(
			<TaskItem task={task()} onSelect={onSelect} />,
		);

		expect(container.querySelector(".status-dot")).toBeTruthy();
	});

	it("renders action menu", () => {
		const { container } = render(
			<TaskItem task={task()} onSelect={onSelect} />,
		);

		expect(container.querySelector(".action-menu")).toBeTruthy();
	});

	it("uses task.name as fallback when display_name is empty", () => {
		render(
			<TaskItem
				task={task({ display_name: "", name: "fallback-name" })}
				onSelect={onSelect}
			/>,
		);

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
			task({ id: "task-1", display_name: "Task 1" }),
			task({ id: "task-2", display_name: "Task 2" }),
		];
		render(<TaskList tasks={tasks} onSelectTask={onSelectTask} />);

		expect(screen.getByText("Task 1")).toBeTruthy();
		expect(screen.getByText("Task 2")).toBeTruthy();
	});
});
