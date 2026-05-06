import { expect, fn, userEvent } from "@storybook/test";

import { task } from "../../../../test/mocks/tasks";
import { withQueryClient } from "@repo/storybook-utils";

import { TasksPanel } from "./TasksPanel";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof TasksPanel> = {
	title: "Tasks/TasksPanel",
	component: TasksPanel,
	decorators: [withQueryClient],
	tags: ["tasks"],
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
	play: async ({ canvasElement }) => {
		// Find all vscode-collapsible elements
		const collapsibles = canvasElement.querySelectorAll("vscode-collapsible");

		// Should have two collapsible sections
		await expect(collapsibles.length).toBe(2);

		// Both should be initially closed
		await expect(collapsibles[0].hasAttribute("open")).toBe(false);
		await expect(collapsibles[1].hasAttribute("open")).toBe(false);

		// Click the first collapsible to toggle it
		await userEvent.click(collapsibles[0]);
		await expect(collapsibles[0].hasAttribute("open")).toBe(true);
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
		// Find the first task item in the list
		const taskItem = canvasElement.querySelector(".task-item");
		await expect(taskItem).toBeTruthy();

		if (!taskItem) {
			throw new Error("Task item not found");
		}

		// Click on the task to select it
		await userEvent.click(taskItem);

		// In Storybook the IPC layer is mocked, so selecting a task triggers
		// a detail fetch that never resolves. The loading spinner is the
		// expected terminal state for this interaction test.
		const loadingContainer = canvasElement.querySelector(".loading-container");
		await expect(loadingContainer).toBeTruthy();
	},
};
