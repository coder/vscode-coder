import { fn } from "@storybook/test";

import { task } from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";

import { TaskList } from "./TaskList";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof TaskList> = {
	title: "Tasks/TaskList",
	component: TaskList,
	decorators: [withQueryClient],
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof TaskList>;

export const Default: Story = {
	args: {
		tasks: [
			task({ id: "task-1" }),
			task({ id: "task-2" }),
			task({ id: "task-3" }),
		],
		onSelectTask: fn(),
	},
};
