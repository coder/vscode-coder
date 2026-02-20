import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBanner } from "@repo/tasks/components/ErrorBanner";

import { task } from "../../mocks/tasks";
import { renderWithQuery } from "../render";

import type { Task } from "@repo/shared";

const { mockApi } = vi.hoisted(() => ({
	mockApi: {
		viewLogs: vi.fn(),
	},
}));

vi.mock("@repo/tasks/hooks/useTasksApi", () => ({
	useTasksApi: () => mockApi,
}));

describe("ErrorBanner", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders error message from current_state.message", () => {
		const t = task({
			status: "error",
			current_state: {
				state: "failed",
				message: "Something broke",
				timestamp: "",
				uri: "",
			},
		});
		renderWithQuery(<ErrorBanner task={t} />);
		expect(screen.getByText("Something broke")).toBeInTheDocument();
	});

	interface FallbackTestCase {
		name: string;
		current_state: Task["current_state"];
	}

	it.each<FallbackTestCase>([
		{ name: "null current_state", current_state: null },
		{
			name: "empty message",
			current_state: { state: "failed", message: "", timestamp: "", uri: "" },
		},
	])('falls back to "Task failed" with $name', ({ current_state }) => {
		const t = task({ status: "error", current_state });
		renderWithQuery(<ErrorBanner task={t} />);
		expect(screen.getByText("Task failed")).toBeInTheDocument();
	});

	it('calls api.viewLogs when "View logs" is clicked', () => {
		const t = task({ id: "task-42", status: "error" });
		renderWithQuery(<ErrorBanner task={t} />);
		fireEvent.click(screen.getByText("View logs"));
		expect(mockApi.viewLogs).toHaveBeenCalledWith({ taskId: "task-42" });
	});
});
