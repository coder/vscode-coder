import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskItem } from "@repo/tasks/components";

import { task } from "../../mocks/tasks";
import { qs } from "../helpers";

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
			name: "Unnamed task fallback",
			overrides: { display_name: "", name: "" },
			expected: "Unnamed task",
		},
	])("renders $name", ({ overrides, expected }) => {
		render(<TaskItem task={task(overrides)} onSelect={onSelect} />);
		expect(screen.getByText(expected)).not.toBeNull();
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
		render(<TaskItem task={task({ id: "task-1" })} onSelect={handleSelect} />);
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
		render(<TaskItem task={task(overrides)} onSelect={onSelect} />);
		expect(screen.getByText(expected)).not.toBeNull();
	});

	it("menu click does not bubble to onSelect", () => {
		const handleSelect = vi.fn();
		const { container } = render(
			<TaskItem task={task()} onSelect={handleSelect} />,
		);
		// The menu wrapper uses stopPropagation — click on the action menu area
		fireEvent.click(qs(container, ".task-item-menu"));
		expect(handleSelect).not.toHaveBeenCalled();
	});
});
