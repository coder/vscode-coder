import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	type RenderResult,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateTaskSection } from "@repo/tasks/components";

import { taskTemplate } from "../../mocks/tasks";
import { qs } from "../helpers";

import type { ReactNode } from "react";

import type { TaskTemplate } from "@repo/shared";

const { mockApi } = vi.hoisted(() => ({
	mockApi: {
		createTask: vi.fn(),
	},
}));

vi.mock("@repo/tasks/hooks/useTasksApi", () => ({
	useTasksApi: () => mockApi,
}));

function WithQueryClient({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={new QueryClient()}>
			{children}
		</QueryClientProvider>
	);
}

function renderSection(templates?: TaskTemplate[]): RenderResult {
	return render(
		<CreateTaskSection templates={templates ?? [taskTemplate()]} />,
		{ wrapper: WithQueryClient },
	);
}

function getTextarea(): HTMLTextAreaElement {
	return screen.getByPlaceholderText<HTMLTextAreaElement>(
		"Prompt your AI agent to start a task...",
	);
}

function submit(): void {
	act(() => {
		fireEvent.keyDown(getTextarea(), { key: "Enter", ctrlKey: true });
	});
}

describe("CreateTaskSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders template options by displayName", () => {
		renderSection([
			taskTemplate({ id: "t1", displayName: "First" }),
			taskTemplate({ id: "t2", displayName: "Second" }),
		]);
		expect(screen.getByText("First")).not.toBeNull();
		expect(screen.getByText("Second")).not.toBeNull();
	});

	it("does not render preset dropdown without presets", () => {
		renderSection([taskTemplate({ presets: [] })]);
		expect(screen.queryByText("Preset:")).toBeNull();
	});

	it("renders preset dropdown when template has presets", () => {
		renderSection([
			taskTemplate({
				presets: [{ id: "p1", name: "Fast Mode", isDefault: false }],
			}),
		]);
		expect(screen.getByText("Preset:")).not.toBeNull();
		expect(screen.getByText("Fast Mode")).not.toBeNull();
	});

	interface SendIconTestCase {
		name: string;
		prompt: string;
	}

	it.each<SendIconTestCase>([
		{ name: "disabled when prompt is empty", prompt: "" },
		{
			name: "enabled when prompt is entered",
			prompt: "Build it",
		},
	])("send icon is $name", ({ prompt }) => {
		const { container } = renderSection();
		if (prompt) {
			fireEvent.change(getTextarea(), { target: { value: prompt } });
		}
		expect(qs(container, "vscode-icon").classList.contains("disabled")).toBe(
			!prompt,
		);
	});

	interface SubmitKeyTestCase {
		name: string;
		keyOpts: { ctrlKey?: boolean; metaKey?: boolean };
		prompt: string;
	}

	it.each<SubmitKeyTestCase>([
		{ name: "Ctrl+Enter", keyOpts: { ctrlKey: true }, prompt: "Build it" },
		{ name: "Meta+Enter", keyOpts: { metaKey: true }, prompt: "Fix bug" },
	])("$name submits", async ({ keyOpts, prompt }) => {
		renderSection();
		fireEvent.change(getTextarea(), { target: { value: prompt } });
		act(() => {
			fireEvent.keyDown(getTextarea(), { key: "Enter", ...keyOpts });
		});
		await waitFor(() => {
			expect(mockApi.createTask).toHaveBeenCalledWith({
				templateVersionId: "version-1",
				prompt,
				presetId: undefined,
			});
		});
	});

	it("plain Enter does not submit", () => {
		renderSection();
		fireEvent.change(getTextarea(), { target: { value: "Build it" } });
		act(() => {
			fireEvent.keyDown(getTextarea(), { key: "Enter" });
		});
		expect(mockApi.createTask).not.toHaveBeenCalled();
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
			expect(getTextarea().value).toBe("");
		});
	});

	it("shows error on failed submit", async () => {
		mockApi.createTask.mockRejectedValueOnce(new Error("Network error"));
		renderSection();
		fireEvent.change(getTextarea(), { target: { value: "Build it" } });
		submit();
		await waitFor(() => {
			expect(screen.getByText("Network error")).not.toBeNull();
		});
		expect(getTextarea().value).toBe("Build it");
	});

	it("disables input and shows spinner while submitting", async () => {
		let resolveCreate: () => void;
		mockApi.createTask.mockReturnValue(
			new Promise<void>((resolve) => {
				resolveCreate = resolve;
			}),
		);

		const { container } = renderSection();
		fireEvent.change(getTextarea(), { target: { value: "Build it" } });
		submit();

		await waitFor(() => {
			expect(getTextarea().disabled).toBe(true);
			expect(container.querySelector("vscode-progress-ring")).not.toBeNull();
		});

		await act(async () => {
			resolveCreate!();
			await Promise.resolve();
		});
	});

	it("syncs templateId when templates change", () => {
		const templates1 = [taskTemplate({ id: "t1", displayName: "Old" })];
		const templates2 = [taskTemplate({ id: "t2", displayName: "New" })];

		const { rerender } = render(<CreateTaskSection templates={templates1} />, {
			wrapper: WithQueryClient,
		});
		expect(screen.getByText("Old")).not.toBeNull();

		rerender(<CreateTaskSection templates={templates2} />);
		expect(screen.getByText("New")).not.toBeNull();
	});
});
