import { task } from "@repo/mocks";
import { withQueryClient } from "@repo/storybook-utils";
import { fn } from "storybook/test";

import { TasksPanel } from "./TasksPanel";

import type { Meta, StoryObj } from "@storybook/react-vite";

const tasks = [
	task({ id: "task-1" }),
	task({ id: "task-2" }),
	task({ id: "task-3" }),
];

const meta: Meta<typeof TasksPanel> = {
	title: "Tasks/TasksPanel",
	component: TasksPanel,
	decorators: [withQueryClient],
	args: {
		tasks,
		templates: [],
		persisted: {
			initialCreateExpanded: true,
			initialHistoryExpanded: true,
			save: fn(),
		},
	},
	parameters: {
		layout: "fullscreen",
	},
};

export default meta;
type Story = StoryObj<typeof TasksPanel>;

export const Default: Story = {};

export const CollapsibleToggle: Story = {
	args: {
		persisted: {
			initialCreateExpanded: false,
			initialHistoryExpanded: false,
			save: fn(),
		},
	},
};

export const TaskSelection: Story = {
	args: {
		persisted: {
			initialCreateExpanded: false,
			initialHistoryExpanded: true,
			save: fn(),
		},
	},
};
