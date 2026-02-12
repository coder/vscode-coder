import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskList } from "@repo/tasks/components/TaskList";

import { task } from "../../mocks/tasks";
import { renderWithQuery } from "../render";

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
		renderWithQuery(<TaskList tasks={[]} onSelectTask={onSelectTask} />);
		expect(screen.queryByText("No tasks yet")).toBeInTheDocument();
	});

	it("renders tasks as buttons in array order", () => {
		const tasks = [
			task({ id: "task-a", display_name: "Alpha" }),
			task({ id: "task-b", display_name: "Beta" }),
		];
		renderWithQuery(<TaskList tasks={tasks} onSelectTask={onSelectTask} />);
		const buttons = screen.getAllByRole("button");
		expect(buttons).toHaveLength(2);
		expect(buttons[0]).toHaveTextContent("Alpha");
		expect(buttons[1]).toHaveTextContent("Beta");
	});

	it("calls onSelectTask when a task is clicked", () => {
		const handleSelect = vi.fn();
		const tasks = [task({ id: "task-1", display_name: "Task 1" })];
		renderWithQuery(<TaskList tasks={tasks} onSelectTask={handleSelect} />);
		fireEvent.click(screen.getByRole("button"));
		expect(handleSelect).toHaveBeenCalledWith("task-1");
	});
});
