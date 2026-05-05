import { fn } from "@storybook/test";

import { task } from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";

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
		tasks: [task(), task(), task()],
		templates: [],
		persisted: {
			initialCreateExpanded: true,
			initialHistoryExpanded: true,
			save: fn(),
		},
	},
};
