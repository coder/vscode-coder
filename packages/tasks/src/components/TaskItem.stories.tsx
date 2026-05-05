import { fn } from "@storybook/test";

import { task } from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";

import { TaskItem } from "./TaskItem";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof TaskItem> = {
	title: "Tasks/TaskItem",
	component: TaskItem,
	decorators: [withQueryClient],
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof TaskItem>;

export const Default: Story = {
	args: {
		task: task(),
		onSelect: fn(),
	},
};
