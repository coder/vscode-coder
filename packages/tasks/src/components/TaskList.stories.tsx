import { Meta, StoryObj } from "@storybook/react";
import { TaskList } from "./TaskList";
import * as M from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";

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
		tasks: [M.MockTask, M.MockTask, M.MockTask],
		onSelectTask: (taskId) => console.log("Selected task:", taskId),
	},
};
