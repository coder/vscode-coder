import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskList } from "@repo/tasks/components";

import { task } from "../../mocks/tasks";

import type { ReactNode } from "react";

vi.mock("@repo/tasks/hooks/useTasksApi", () => ({
	useTasksApi: () => ({
		pauseTask: vi.fn(),
		resumeTask: vi.fn(),
		deleteTask: vi.fn(),
		viewInCoder: vi.fn(),
		downloadLogs: vi.fn(),
	}),
}));

function renderWithQuery(ui: ReactNode) {
	return render(ui, {
		wrapper: ({ children }) => (
			<QueryClientProvider client={new QueryClient()}>
				{children}
			</QueryClientProvider>
		),
	});
}

describe("TaskList", () => {
	const onSelectTask = vi.fn();

	it("renders empty state when no tasks", () => {
		renderWithQuery(<TaskList tasks={[]} onSelectTask={onSelectTask} />);
		expect(screen.getByText("No tasks yet")).not.toBeNull();
	});

	it("renders tasks as buttons in array order", () => {
		const tasks = [
			task({ id: "task-a", display_name: "Alpha" }),
			task({ id: "task-b", display_name: "Beta" }),
		];
		renderWithQuery(<TaskList tasks={tasks} onSelectTask={onSelectTask} />);
		const buttons = screen.getAllByRole("button");
		expect(buttons).toHaveLength(2);
		expect(buttons[0].textContent).toContain("Alpha");
		expect(buttons[1].textContent).toContain("Beta");
	});

	it("calls onSelectTask when a task is clicked", () => {
		const handleSelect = vi.fn();
		const tasks = [task({ id: "task-1", display_name: "Task 1" })];
		renderWithQuery(<TaskList tasks={tasks} onSelectTask={handleSelect} />);
		fireEvent.click(screen.getByRole("button"));
		expect(handleSelect).toHaveBeenCalledWith("task-1");
	});
});
