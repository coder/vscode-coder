import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskItem } from "@repo/tasks/components/TaskItem";

import { task } from "../../mocks/tasks";
import { renderWithQuery } from "../render";

import type { Task } from "@repo/shared";

vi.mock("@repo/tasks/hooks/useTasksApi", () => ({
	useTasksApi: () => ({
		pauseTask: vi.fn(),
		resumeTask: vi.fn(),
		deleteTask: vi.fn(),
		viewInCoder: vi.fn(),
		downloadLogs: vi.fn(),
	}),
}));

describe("TaskItem", () => {
	const onSelect = vi.fn();

	interface DisplayNameTestCase {
		name: string;
		overrides: Partial<Task>;
		expected: string;
	}

	it.each<DisplayNameTestCase>([
		{
			name: "display_name",
			overrides: { display_name: "My Task" },
			expected: "My Task",
		},
		{
			name: "name fallback",
			overrides: { display_name: "", name: "fallback" },
			expected: "fallback",
		},
		{
			name: "id fallback",
			overrides: { display_name: "", name: "" },
			expected: "task-1",
		},
	])("renders $name", ({ overrides, expected }) => {
		renderWithQuery(<TaskItem task={task(overrides)} onSelect={onSelect} />);
		expect(screen.queryByText(expected)).toBeInTheDocument();
	});

	interface SelectTestCase {
		name: string;
		trigger: (el: Element) => void;
	}

	it.each<SelectTestCase>([
		{ name: "click", trigger: (el) => fireEvent.click(el) },
		{
			name: "Enter key",
			trigger: (el) => fireEvent.keyDown(el, { key: "Enter" }),
		},
		{
			name: "Space key",
			trigger: (el) => fireEvent.keyDown(el, { key: " " }),
		},
	])("calls onSelect on $name", ({ trigger }) => {
		const handleSelect = vi.fn();
		renderWithQuery(
			<TaskItem task={task({ id: "task-1" })} onSelect={handleSelect} />,
		);
		trigger(screen.getByRole("button"));
		expect(handleSelect).toHaveBeenCalledWith("task-1");
	});

	interface SubtitleTestCase {
		name: string;
		overrides: Partial<Task>;
		expected: string;
	}

	it.each<SubtitleTestCase>([
		{
			name: "current_state.message",
			overrides: {
				current_state: {
					state: "working",
					message: "Compiling...",
					timestamp: "",
					uri: "",
				},
			},
			expected: "Compiling...",
		},
		{
			name: "fallback when current_state is null",
			overrides: { current_state: null },
			expected: "No message available",
		},
	])("shows subtitle from $name", ({ overrides, expected }) => {
		renderWithQuery(<TaskItem task={task(overrides)} onSelect={onSelect} />);
		expect(screen.queryByText(expected)).toBeInTheDocument();
	});

	it("menu click does not bubble to onSelect", () => {
		const handleSelect = vi.fn();
		const { container } = renderWithQuery(
			<TaskItem task={task()} onSelect={handleSelect} />,
		);
		fireEvent.click(container.querySelector(".task-item-menu")!);
		expect(handleSelect).not.toHaveBeenCalled();
	});
});
