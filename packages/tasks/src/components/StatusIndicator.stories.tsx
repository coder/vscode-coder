import type { Meta, StoryObj } from "@storybook/react";
import { StatusIndicator } from "./StatusIndicator";
import { task } from "../../../../test/mocks/tasks";

const meta: Meta<typeof StatusIndicator> = {
	title: "Tasks/StatusIndicator",
	component: StatusIndicator,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
	args: {
		task: task(),
	},
};

export const Error: Story = {
	args: {
		task: task({ status: "error" }),
	},
};

export const Initializing: Story = {
	args: {
		task: task({ status: "initializing" }),
	},
};

export const Paused: Story = {
	args: {
		task: task({ status: "paused" }),
	},
};

export const Pending: Story = {
	args: {
		task: task({ status: "pending" }),
	},
};

export const Unknown: Story = {
	args: {
		task: task({ status: "unknown" }),
	},
};
