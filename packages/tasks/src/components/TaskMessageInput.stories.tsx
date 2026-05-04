import { Meta, StoryObj } from "@storybook/react";
import { TaskMessageInput } from "./TaskMessageInput";
import * as M from "../testHelpers/entities";
import { withQueryClient } from "../testHelpers/decorators";

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
		task: M.MockTask,
	},
};

export const Paused: Story = {
	args: {
		task: { ...M.MockTask, status: "paused" },
	},
};

export const Error: Story = {
	args: {
		task: { ...M.MockTask, status: "error" },
	},
};
