import { Meta, StoryObj } from "@storybook/react";
import { TaskMessageInput } from "./TaskMessageInput";
import { task } from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";

const meta: Meta<typeof TaskMessageInput> = {
	title: "Tasks/TaskMessageInput",
	component: TaskMessageInput,
	decorators: [withQueryClient],
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof TaskMessageInput>;

export const Active: Story = {
	args: {
		task: task(),
	},
};

export const Paused: Story = {
	args: {
		task: task({ status: "paused" }),
	},
};

export const Error: Story = {
	args: {
		task: task({ status: "error" }),
	},
};
