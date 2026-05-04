import { Meta, StoryObj } from "@storybook/react";
import { TaskItem } from "./TaskItem";
import * as M from "../testHelpers/entities";

const meta: Meta<typeof TaskItem> = {
	title: "Tasks/TaskItem",
	component: TaskItem,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof TaskItem>;

// TODO: We use a query client here, we should mock that?

// export const Default: Story = {
// 	args: {
// 		task: M.MockTask,
// 	},
// };
