import { fn } from "@storybook/test";

import { task } from "@repo/mocks";
import { withQueryClient } from "@repo/storybook-utils";

import { TaskDetailHeader } from "./TaskDetailHeader";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof TaskDetailHeader> = {
	title: "Tasks/TaskDetailHeader",
	component: TaskDetailHeader,
	decorators: [withQueryClient],
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof TaskDetailHeader>;

export const Default: Story = {
	args: {
		task: task(),
		onBack: fn(),
	},
};
