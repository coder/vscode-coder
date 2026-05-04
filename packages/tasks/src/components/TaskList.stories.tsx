import { Meta, StoryObj } from "@storybook/react";
import { TaskList } from "./TaskList";
import * as M from "../testHelpers/entities";

const meta: Meta<typeof TaskList> = {
	title: "Tasks/TaskList",
	component: TaskList,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof TaskList>;

// TODO: We use a query client here, we should mock that?

// export const Default: Story = {
// 	args: {
// 		tasks: [M.MockTask, M.MockTask, M.MockTask],
// 	},
// };
