import { Meta, StoryObj } from "@storybook/react";
import { TaskDetailHeader } from "./TaskDetailHeader";
import * as M from "../../../../test/mocks/tasks";
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
		task: M.MockTask,
		onBack: () => console.log("Back clicked"),
	},
};
