import { Meta, StoryObj } from "@storybook/react";
import { StatusIndicator } from "./StatusIndicator";
import * as M from "../testHelpers/entities";

const meta: Meta<typeof StatusIndicator> = {
	title: "Tasks/StatusIndicator",
	component: StatusIndicator,
	tags: ["tasks"],
} satisfies Meta<typeof StatusIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
	args: {
		task: M.MockTask,
	},
};

export const Error: Story = {
	args: {
		task: {
			...M.MockTask,
			status: "error",
		},
	},
};

export const Initializing: Story = {
	args: {
		task: {
			...M.MockTask,
			status: "initializing",
		},
	},
};

export const Paused: Story = {
	args: {
		task: {
			...M.MockTask,
			status: "paused",
		},
	},
};

export const Pending: Story = {
	args: {
		task: {
			...M.MockTask,
			status: "pending",
		},
	},
};

export const Unknown: Story = {
	args: {
		task: {
			...M.MockTask,
			status: "unknown",
		},
	},
};
