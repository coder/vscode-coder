import { task } from "@repo/mocks";
import { withQueryClient } from "@repo/storybook-utils";
import { fn } from "@storybook/test";

import { TaskList } from "./TaskList";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof TaskList> = {
	title: "Tasks/TaskList",
	component: TaskList,
	decorators: [withQueryClient],
};

export default meta;
type Story = StoryObj<typeof TaskList>;

export const Default: Story = {
	args: {
		tasks: [
			task({ id: "task-1" }),
			task({ id: "task-2", status: "unknown" }),
			task({ id: "task-3", status: "error" }),
			task({ id: "task-4", status: "paused" }),
			task({ id: "task-5", status: "initializing" }),
		],
		onSelectTask: fn(),
	},
};
