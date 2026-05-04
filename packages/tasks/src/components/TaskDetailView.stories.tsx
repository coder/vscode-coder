import { Meta, StoryObj } from "@storybook/react";
import { TaskDetailView } from "./TaskDetailView";
import * as M from "../testHelpers/entities";

const meta: Meta<typeof TaskDetailView> = {
	title: "Tasks/TaskDetailView",
	component: TaskDetailView,
};

export default meta;
type Story = StoryObj<typeof TaskDetailView>;

// TODO: We use a query client here, we should mock that?

// export const Default: Story = {
// 	args: {
// 		details: M.MockTaskDetails,
// 	},
// };
