import { Meta, StoryObj } from "@storybook/react";
import { TaskItem } from "./TaskItem";
import * as M from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";

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
		task: M.MockTask,
		onSelect: (taskId) => console.log("Task selected:", taskId),
	},
};
