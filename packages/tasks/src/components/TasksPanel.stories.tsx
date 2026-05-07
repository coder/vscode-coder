import { task } from "@repo/mocks";
import { withQueryClient } from "@repo/storybook-utils";
import { fn } from "storybook/test";

import { withTasksStyles } from "../utils/storybook";

import { TasksPanel } from "./TasksPanel";

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta<typeof TasksPanel> = {
	title: "Tasks/TasksPanel",
	component: TasksPanel,
	decorators: [withTasksStyles, withQueryClient],
	parameters: {
		layout: "fullscreen",
	},
	args: {
		tasks: [
			task({ id: "task-1" }),
			task({ id: "task-2" }),
			task({ id: "task-3" }),
		],
		templates: [],
	},
};

export default meta;
type Story = StoryObj<typeof TasksPanel>;

export const Default: Story = {
	args: {
		persisted: {
			initialCreateExpanded: true,
			initialHistoryExpanded: true,
			save: fn(),
		},
	},
};

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
