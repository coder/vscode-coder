import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskList } from "@repo/tasks/components";

import { task } from "../../mocks/tasks";

vi.mock("@repo/tasks/hooks/useTasksApi", () => ({
	useTasksApi: () => ({
		pauseTask: vi.fn(),
		resumeTask: vi.fn(),
		deleteTask: vi.fn(),
		viewInCoder: vi.fn(),
		downloadLogs: vi.fn(),
	}),
}));

describe("TaskList", () => {
	const onSelectTask = vi.fn();

	it("renders empty state when no tasks", () => {
		render(<TaskList tasks={[]} onSelectTask={onSelectTask} />);
		expect(screen.getByText("No tasks yet")).not.toBeNull();
	});

	it("renders a button for each task", () => {
		const tasks = [
			task({ id: "task-1", display_name: "Task 1" }),
			task({ id: "task-2", display_name: "Task 2" }),
		];
		render(<TaskList tasks={tasks} onSelectTask={onSelectTask} />);
		expect(screen.getByText("Task 1")).not.toBeNull();
		expect(screen.getByText("Task 2")).not.toBeNull();
		expect(screen.getAllByRole("button")).toHaveLength(tasks.length);
	});

	it("calls onSelectTask when a task is clicked", () => {
		const handleSelect = vi.fn();
		const tasks = [task({ id: "task-1", display_name: "Task 1" })];
		render(<TaskList tasks={tasks} onSelectTask={handleSelect} />);
		fireEvent.click(screen.getByRole("button"));
		expect(handleSelect).toHaveBeenCalledWith("task-1");
	});

	it("renders tasks in array order", () => {
		const tasks = [
			task({ id: "task-a", display_name: "Alpha" }),
			task({ id: "task-b", display_name: "Beta" }),
		];
		render(<TaskList tasks={tasks} onSelectTask={onSelectTask} />);
		const buttons = screen.getAllByRole("button");
		expect(buttons[0].textContent).toContain("Alpha");
		expect(buttons[1].textContent).toContain("Beta");
	});
});
