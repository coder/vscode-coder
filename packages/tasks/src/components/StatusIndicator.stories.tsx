import { task } from "@repo/mocks";

import { StatusIndicator } from "./StatusIndicator";

import { withTasksStyles } from "../decorators";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof StatusIndicator> = {
	title: "Tasks/StatusIndicator",
	component: StatusIndicator,
	decorators: [withTasksStyles],
};

export default meta;
type Story = StoryObj<typeof StatusIndicator>;

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
