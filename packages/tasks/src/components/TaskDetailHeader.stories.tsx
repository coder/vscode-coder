import { task } from "@repo/mocks";
import { withQueryClient } from "@repo/storybook-utils";
import { fn } from "@storybook/test";
import { TaskDetailHeader } from "./TaskDetailHeader";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof TaskDetailHeader> = {
	title: "Tasks/TaskDetailHeader",
	component: TaskDetailHeader,
	decorators: [withQueryClient],
};

export default meta;
type Story = StoryObj<typeof TaskDetailHeader>;

export const Default: Story = {
	args: {
		task: task(),
		onBack: fn(),
	},
};
