import { Meta, StoryObj } from "@storybook/react";
import { TaskDetailHeader } from "./TaskDetailHeader";
import * as M from "../testHelpers/entities";

const meta: Meta<typeof TaskDetailHeader> = {
	title: "Tasks/TaskDetailHeader",
	component: TaskDetailHeader,
};

export default meta;
type Story = StoryObj<typeof TaskDetailHeader>;

// TODO: We use a query client here, we should mock that?

// export const Default: Story = {
// 	args: {
// 		task: M.MockTask,
// 	},
// };
