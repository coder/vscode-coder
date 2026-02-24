import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateTaskSection } from "@repo/tasks/components/CreateTaskSection";
import { logger } from "@repo/webview-shared/logger";

import { taskTemplate } from "../../mocks/tasks";
import { renderWithQuery } from "../render";

import type { TaskTemplate } from "@repo/shared";

const { mockApi } = vi.hoisted(() => ({
	mockApi: {
		createTask: vi.fn(),
	},
}));

vi.mock("@repo/tasks/hooks/useTasksApi", () => ({
	useTasksApi: () => mockApi,
}));

function renderSection(templates?: TaskTemplate[]) {
	return renderWithQuery(
		<CreateTaskSection templates={templates ?? [taskTemplate()]} />,
	);
}

function getTextarea(): HTMLTextAreaElement {
	return screen.getByPlaceholderText<HTMLTextAreaElement>(
		"Prompt your AI agent to start a task...",
	);
}

function submit(): void {
	fireEvent.keyDown(getTextarea(), { key: "Enter", ctrlKey: true });
}

describe("CreateTaskSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders template options by name", () => {
		renderSection([
			taskTemplate({ id: "t1", name: "First" }),
			taskTemplate({ id: "t2", name: "Second" }),
		]);
		expect(screen.queryByText("First")).toBeInTheDocument();
		expect(screen.queryByText("Second")).toBeInTheDocument();
	});

	it("does not render preset dropdown without presets", () => {
		renderSection([taskTemplate({ presets: [] })]);
		expect(screen.queryByText("Preset:")).not.toBeInTheDocument();
	});

	it("renders preset dropdown when template has presets", () => {
		renderSection([
			taskTemplate({
				presets: [
					{
						id: "p1",
						name: "Fast Mode",
						description: "A fast preset",
						isDefault: false,
					},
				],
			}),
		]);
		expect(screen.queryByText("Preset:")).toBeInTheDocument();
		expect(screen.queryByText("Fast Mode")).toBeInTheDocument();
	});

	it("does not submit with empty prompt", () => {
		renderSection();
		submit();
		expect(mockApi.createTask).not.toHaveBeenCalled();
	});

	it("clears prompt after successful submit", async () => {
		renderSection();
		fireEvent.change(getTextarea(), { target: { value: "Build it" } });
		submit();
		await waitFor(() => {
			expect(getTextarea()).toHaveValue("");
		});
	});

	it("shows error on failed submit", async () => {
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		mockApi.createTask.mockRejectedValueOnce(new Error("Network error"));
		renderSection();
		fireEvent.change(getTextarea(), { target: { value: "Build it" } });
		submit();
		await waitFor(() => {
			expect(screen.queryByText("Network error")).toBeInTheDocument();
		});
		expect(getTextarea()).toHaveValue("Build it");
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("syncs templateId when templates change", () => {
		const templates1 = [taskTemplate({ id: "t1", name: "Old" })];
		const templates2 = [taskTemplate({ id: "t2", name: "New" })];

		const { rerender } = renderWithQuery(
			<CreateTaskSection templates={templates1} />,
		);
		expect(screen.queryByText("Old")).toBeInTheDocument();

		rerender(<CreateTaskSection templates={templates2} />);
		expect(screen.queryByText("New")).toBeInTheDocument();
	});
});
