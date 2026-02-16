import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskDetailView } from "@repo/tasks/components/TaskDetailView";

import { logEntry, taskDetails, taskState } from "../../mocks/tasks";
import { qs } from "../helpers";
import { renderWithQuery } from "../render";

import type { Task } from "@repo/shared";

vi.mock("@repo/tasks/hooks/useTasksApi", () => ({
	useTasksApi: () => new Proxy({}, { get: () => vi.fn() }),
}));

vi.mock("@repo/tasks/hooks/useWorkspaceLogs", () => ({
	useWorkspaceLogs: (active: boolean) => (active ? ["Building image..."] : []),
}));

describe("TaskDetailView", () => {
	it("passes onBack to header", () => {
		const onBack = vi.fn();
		const { container } = renderWithQuery(
			<TaskDetailView details={taskDetails()} onBack={onBack} />,
		);
		qs<HTMLElement>(container, "vscode-icon").click();
		expect(onBack).toHaveBeenCalled();
	});

	it("passes logs to chat history", () => {
		const details = taskDetails({
			logs: [
				logEntry({ id: 1, content: "Starting build..." }),
				logEntry({ id: 2, content: "Build complete." }),
			],
		});
		renderWithQuery(<TaskDetailView details={details} onBack={() => {}} />);
		expect(screen.getByText("Starting build...")).toBeInTheDocument();
		expect(screen.getByText("Build complete.")).toBeInTheDocument();
	});

	it("shows error banner only when status is error", () => {
		const errorDetails = taskDetails({
			task: {
				status: "error",
				current_state: {
					state: "failed",
					message: "Something went wrong",
					timestamp: "",
					uri: "",
				},
			},
		});
		const { container, rerender } = renderWithQuery(
			<TaskDetailView details={errorDetails} onBack={() => {}} />,
		);
		expect(screen.getByText("Something went wrong")).toBeInTheDocument();

		const activeDetails = taskDetails({ task: { status: "active" } });
		rerender(<TaskDetailView details={activeDetails} onBack={() => {}} />);
		expect(container.querySelector(".error-banner")).not.toBeInTheDocument();
	});

	interface ThinkingTestCase {
		name: string;
		taskOverrides: Partial<Task>;
		expected: boolean;
	}

	it.each<ThinkingTestCase>([
		{
			name: "active+working",
			taskOverrides: {
				status: "active",
				current_state: taskState("working"),
			},
			expected: true,
		},
		{
			name: "active+complete",
			taskOverrides: {
				status: "active",
				current_state: taskState("complete"),
			},
			expected: false,
		},
		{
			name: "active with null state",
			taskOverrides: { status: "active", current_state: null },
			expected: false,
		},
		{
			name: "paused+working",
			taskOverrides: {
				status: "paused",
				current_state: taskState("working"),
			},
			expected: false,
		},
	])("$name → Thinking... is $expected", ({ taskOverrides, expected }) => {
		const details = taskDetails({ task: taskOverrides });
		renderWithQuery(<TaskDetailView details={details} onBack={() => {}} />);
		const matcher = expect(screen.queryByText("Thinking..."));
		if (expected) {
			matcher.toBeInTheDocument();
		} else {
			matcher.not.toBeInTheDocument();
		}
	});

	it("passes task status to message input placeholder", () => {
		const details = taskDetails({ task: { status: "paused" } });
		renderWithQuery(<TaskDetailView details={details} onBack={() => {}} />);
		expect(screen.getByRole("textbox")).toHaveAttribute(
			"placeholder",
			"Send a message to resume the task...",
		);
	});

	it("shows logsStatus error in chat history", () => {
		const details = taskDetails({ logsStatus: "error" });
		renderWithQuery(<TaskDetailView details={details} onBack={() => {}} />);
		expect(screen.getByText("Failed to load logs")).toBeInTheDocument();
	});

	describe("workspace startup rendering", () => {
		it("shows WorkspaceLogs when workspace is building", () => {
			const details = taskDetails({
				task: { workspace_status: "starting" },
			});
			renderWithQuery(<TaskDetailView details={details} onBack={() => {}} />);
			expect(screen.getByText("Building workspace...")).toBeInTheDocument();
			expect(screen.getByText("Building image...")).toBeInTheDocument();
			expect(screen.queryByText("Agent chat history")).not.toBeInTheDocument();
		});

		it("shows WorkspaceLogs when agent is starting", () => {
			const details = taskDetails({
				task: {
					workspace_status: "running",
					workspace_agent_lifecycle: "created",
				},
			});
			renderWithQuery(<TaskDetailView details={details} onBack={() => {}} />);
			expect(
				screen.getByText("Running startup scripts..."),
			).toBeInTheDocument();
			expect(screen.queryByText("Agent chat history")).not.toBeInTheDocument();
		});

		it("shows AgentChatHistory when workspace is running and agent is ready", () => {
			const details = taskDetails({
				task: {
					workspace_status: "running",
					workspace_agent_lifecycle: "ready",
				},
			});
			renderWithQuery(<TaskDetailView details={details} onBack={() => {}} />);
			expect(screen.getByText("Agent chat history")).toBeInTheDocument();
			expect(
				screen.queryByText("Building workspace..."),
			).not.toBeInTheDocument();
		});
	});
});
