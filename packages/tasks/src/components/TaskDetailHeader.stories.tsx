import { Meta, StoryObj } from "@storybook/react";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { task } from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";

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
		onBack: () => console.log("Back clicked"),
	},
};
