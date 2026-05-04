import { Meta, StoryObj } from "@storybook/react";
import { TaskMessageInput } from "./TaskMessageInput";

const meta: Meta<typeof TaskMessageInput> = {
	title: "Tasks/TaskMessageInput",
	component: TaskMessageInput,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof TaskMessageInput>;

// TODO: We use a query client here, we should mock that?

// export const Default: Story = {
// 	args: {},
// };
