import type { Meta, StoryObj } from "@storybook/react";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { task } from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";
import { fn } from "@storybook/test";

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
