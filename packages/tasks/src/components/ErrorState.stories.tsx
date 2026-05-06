import { fn } from "@storybook/test";

import { ErrorState } from "./ErrorState";

import { withTasksStyles } from "../decorators";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof ErrorState> = {
	title: "Tasks/ErrorState",
	component: ErrorState,
	decorators: [withTasksStyles],
};

export default meta;
type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {
	args: {
		message: "Task failed",
		onRetry: fn(),
	},
};
