import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskDetailHeader } from "@repo/tasks/components/TaskDetailHeader";

import { task, taskState } from "../../mocks/tasks";
import { qs } from "../helpers";
import { renderWithQuery } from "../render";

import type { Task } from "@repo/shared";

const { mockApi } = vi.hoisted(() => ({
	mockApi: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@repo/tasks/hooks/useTasksApi", () => ({
	useTasksApi: () =>
		new Proxy(mockApi, {
			get: (t, p) => (typeof p === "string" ? (t[p] ?? vi.fn()) : vi.fn()),
		}),
}));

describe("TaskDetailHeader", () => {
	beforeEach(() => {
		for (const key of Object.keys(mockApi)) {
			delete mockApi[key];
		}
	});

	it("renders task label from display_name", () => {
		renderWithQuery(
			<TaskDetailHeader
				task={task({ display_name: "My Cool Task" })}
				onBack={() => {}}
			/>,
		);
		expect(screen.getByText("My Cool Task")).toBeInTheDocument();
	});

	it("calls onBack when back arrow is clicked", () => {
		const handleBack = vi.fn();
		const { container } = renderWithQuery(
			<TaskDetailHeader task={task()} onBack={handleBack} />,
		);
		const backButton = qs<HTMLElement>(container, "vscode-icon");
		backButton.click();
		expect(handleBack).toHaveBeenCalled();
	});

	it("renders StatusIndicator with status dot", () => {
		const { container } = renderWithQuery(
			<TaskDetailHeader task={task({ status: "active" })} onBack={() => {}} />,
		);
		const dot = qs(container, ".status-dot.active");
		expect(dot).toHaveAttribute("title", "Active");
	});

	interface ActionLabelTestCase {
		name: string;
		taskOverrides: Partial<Task>;
		apiMethod: string;
		menuLabel: string;
		expectedLabel: string;
	}

	it.each<ActionLabelTestCase>([
		{
			name: "Pause",
			taskOverrides: {
				status: "active",
				current_state: taskState("working"),
				workspace_id: "ws-1",
			},
			apiMethod: "pauseTask",
			menuLabel: "Pause Task",
			expectedLabel: "Pausing...",
		},
		{
			name: "Resume",
			taskOverrides: { status: "paused", workspace_id: "ws-1" },
			apiMethod: "resumeTask",
			menuLabel: "Resume Task",
			expectedLabel: "Resuming...",
		},
		{
			name: "Delete",
			taskOverrides: {},
			apiMethod: "deleteTask",
			menuLabel: "Delete",
			expectedLabel: "Deleting...",
		},
		{
			name: "Download",
			taskOverrides: {},
			apiMethod: "downloadLogs",
			menuLabel: "Download Logs",
			expectedLabel: "Downloading...",
		},
	])(
		"shows $expectedLabel while $name is pending, hides after resolve",
		async ({ taskOverrides, apiMethod, menuLabel, expectedLabel }) => {
			let resolve!: () => void;
			mockApi[apiMethod] = vi.fn().mockReturnValue(
				new Promise<void>((r) => {
					resolve = r;
				}),
			);

			const { container } = renderWithQuery(
				<TaskDetailHeader task={task(taskOverrides)} onBack={() => {}} />,
			);

			fireEvent.click(qs(container, ".action-menu vscode-icon"));
			fireEvent.click(screen.getByText(menuLabel));

			await waitFor(() => {
				expect(screen.getByText(expectedLabel)).toBeInTheDocument();
			});

			resolve();

			await waitFor(() => {
				expect(screen.queryByText(expectedLabel)).not.toBeInTheDocument();
			});
		},
	);
});
