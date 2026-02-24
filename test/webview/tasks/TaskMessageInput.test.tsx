import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskMessageInput } from "@repo/tasks/components/TaskMessageInput";

import { task, taskState } from "../../mocks/tasks";
import { qs } from "../helpers";
import { renderWithQuery } from "../render";

import type { Task } from "@repo/shared";

const { mockApi } = vi.hoisted(() => ({
	mockApi: {
		pauseTask: vi.fn(),
		resumeTask: vi.fn(),
		sendTaskMessage: vi.fn(),
	},
}));

vi.mock("@repo/tasks/hooks/useTasksApi", () => ({
	useTasksApi: () => mockApi,
}));

function getTextarea(): HTMLTextAreaElement {
	return screen.getByRole<HTMLTextAreaElement>("textbox");
}

describe("TaskMessageInput", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	interface PlaceholderTestCase {
		name: string;
		overrides: Partial<Task>;
		expected: string;
	}

	it.each<PlaceholderTestCase>([
		{
			name: "paused",
			overrides: { status: "paused" },
			expected: "Resume the task to send messages",
		},
		{
			name: "pending",
			overrides: { status: "pending" },
			expected: "Waiting for the agent to start...",
		},
		{
			name: "initializing",
			overrides: { status: "initializing" },
			expected: "Waiting for the agent to start...",
		},
		{
			name: "error",
			overrides: { status: "error" },
			expected: "Task is in an error state and cannot receive messages",
		},
		{
			name: "unknown",
			overrides: { status: "unknown" },
			expected: "Task is in an error state and cannot receive messages",
		},
		{
			name: "active+working",
			overrides: { status: "active", current_state: taskState("working") },
			expected: "Agent is working — you can pause or wait for it to finish...",
		},
		{
			name: "active+complete",
			overrides: { status: "active", current_state: taskState("complete") },
			expected: "Task completed — send a follow-up to continue...",
		},
		{
			name: "active+failed",
			overrides: { status: "active", current_state: taskState("failed") },
			expected: "Task failed — send a message to retry...",
		},
		{
			name: "active with no current_state",
			overrides: { status: "active", current_state: null },
			expected: "Send a message to the agent...",
		},
	])("shows placeholder for $name", ({ overrides, expected }) => {
		renderWithQuery(<TaskMessageInput task={task(overrides)} />);
		expect(getTextarea()).toHaveAttribute("placeholder", expected);
	});

	it("shows enabled action button when active+working+canPause", () => {
		const t = task({
			status: "active",
			current_state: taskState("working"),
			workspace_id: "ws-1",
		});
		const { container } = renderWithQuery(<TaskMessageInput task={t} />);
		const icon = qs(container, "vscode-icon");
		expect(icon).not.toHaveClass("disabled");
	});

	it("enables send icon after typing a message", () => {
		const t = task({
			status: "active",
			current_state: taskState("complete"),
		});
		const { container } = renderWithQuery(<TaskMessageInput task={t} />);
		expect(qs(container, "vscode-icon")).toHaveClass("disabled");

		fireEvent.change(getTextarea(), { target: { value: "hello" } });
		expect(qs(container, "vscode-icon")).not.toHaveClass("disabled");
	});

	it("does not send on Ctrl+Enter when message is empty", () => {
		const t = task({
			status: "active",
			current_state: taskState("complete"),
		});
		renderWithQuery(<TaskMessageInput task={t} />);
		fireEvent.keyDown(getTextarea(), { key: "Enter", ctrlKey: true });
		expect(mockApi.sendTaskMessage).not.toHaveBeenCalled();
	});

	it("disables input when task cannot send messages and pause not showing", () => {
		const t = task({
			status: "error",
			workspace_id: null,
			current_state: null,
		});
		renderWithQuery(<TaskMessageInput task={t} />);
		expect(getTextarea()).toBeDisabled();
	});

	it("keeps input enabled when canSendMessage is false but pause button shows", () => {
		// active+working: canSendMessage=false, but showPauseButton=true
		const t = task({
			status: "active",
			current_state: taskState("working"),
			workspace_id: "ws-1",
		});
		renderWithQuery(<TaskMessageInput task={t} />);
		expect(getTextarea()).not.toBeDisabled();
	});

	it("keeps input enabled when canSendMessage is true", () => {
		const t = task({
			status: "active",
			current_state: taskState("complete"),
		});
		renderWithQuery(<TaskMessageInput task={t} />);
		expect(getTextarea()).not.toBeDisabled();
	});

	it("sends message via sendTaskMessage on Ctrl+Enter", async () => {
		mockApi.sendTaskMessage.mockResolvedValueOnce(undefined);
		const t = task({
			status: "active",
			current_state: taskState("complete"),
		});
		renderWithQuery(<TaskMessageInput task={t} />);

		fireEvent.change(getTextarea(), { target: { value: "Hello agent" } });
		fireEvent.keyDown(getTextarea(), { key: "Enter", ctrlKey: true });

		await waitFor(() => {
			expect(mockApi.sendTaskMessage).toHaveBeenCalledWith({
				taskId: "task-1",
				message: "Hello agent",
			});
		});
		await waitFor(() => {
			expect(getTextarea()).toHaveValue("");
		});
	});

	it("shows enabled action button for paused task with workspace", () => {
		const t = task({
			status: "paused",
			workspace_id: "ws-1",
		});
		const { container } = renderWithQuery(<TaskMessageInput task={t} />);
		const icon = qs(container, "vscode-icon");
		expect(icon).not.toHaveClass("disabled");
	});

	it("disables input for paused task", () => {
		const t = task({
			status: "paused",
			workspace_id: "ws-1",
		});
		renderWithQuery(<TaskMessageInput task={t} />);
		expect(getTextarea()).toBeDisabled();
	});

	it("calls resumeTask on Ctrl+Enter when resume button is showing", async () => {
		mockApi.resumeTask.mockResolvedValueOnce(undefined);
		const t = task({
			status: "paused",
			workspace_id: "ws-1",
		});
		renderWithQuery(<TaskMessageInput task={t} />);
		fireEvent.keyDown(getTextarea(), { key: "Enter", ctrlKey: true });
		await waitFor(() => {
			expect(mockApi.resumeTask).toHaveBeenCalledWith({
				taskId: "task-1",
				taskName: "Test Task",
			});
		});
	});

	it("calls pauseTask on Ctrl+Enter when pause button is showing", async () => {
		const t = task({
			status: "active",
			current_state: taskState("working"),
			workspace_id: "ws-1",
		});
		renderWithQuery(<TaskMessageInput task={t} />);
		fireEvent.keyDown(getTextarea(), { key: "Enter", ctrlKey: true });
		await waitFor(() => {
			expect(mockApi.pauseTask).toHaveBeenCalledWith({
				taskId: "task-1",
				taskName: "Test Task",
			});
		});
	});
});
