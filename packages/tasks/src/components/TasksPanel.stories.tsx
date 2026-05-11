import { task } from "@repo/mocks";
import { withQueryClient } from "@repo/storybook-utils";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { TasksPanel } from "./TasksPanel";

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta<typeof TasksPanel> = {
	title: "Tasks/TasksPanel",
	component: TasksPanel,
	decorators: [withQueryClient],
	parameters: {
		layout: "fullscreen",
	},
};

export default meta;
type Story = StoryObj<typeof TasksPanel>;

export const Default: Story = {
	args: {
		tasks: [
			task({ id: "task-1" }),
			task({ id: "task-2" }),
			task({ id: "task-3" }),
		],
		templates: [],
		persisted: {
			initialCreateExpanded: true,
			initialHistoryExpanded: true,
			save: fn(),
		},
	},
};

export const CollapsibleToggle: Story = {
	args: {
		tasks: [
			task({ id: "task-1" }),
			task({ id: "task-2" }),
			task({ id: "task-3" }),
		],
		templates: [],
		persisted: {
			initialCreateExpanded: false,
			initialHistoryExpanded: false,
			save: fn(),
		},
	},
};

export const TaskSelection: Story = {
	args: {
		tasks: [
			task({ id: "task-1" }),
			task({ id: "task-2" }),
			task({ id: "task-3" }),
		],
		templates: [],
		persisted: {
			initialCreateExpanded: false,
			initialHistoryExpanded: true,
			save: fn(),
		},
	},
	play: async ({ canvasElement }) => {
		const taskItems = canvasElement.querySelectorAll(".task-item");
		await expect(taskItems.length).toBeGreaterThan(0);

		// Click the second task to select it
		const secondTask = taskItems[1];
		await expect(secondTask).toBeTruthy();
		if (!secondTask) throw new Error("Second task not found");

		await userEvent.click(secondTask);

		// Wait for the task detail view to appear
		await waitFor(async () => {
			const detailView = canvasElement.querySelector(".task-detail-view");
			await expect(detailView).toBeTruthy();
		});
	},
};
