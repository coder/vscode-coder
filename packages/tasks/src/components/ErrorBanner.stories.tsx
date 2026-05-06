import { task } from "@repo/mocks";

import { ErrorBanner } from "./ErrorBanner";

import { withTasksStyles } from "../utils/storybook";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof ErrorBanner> = {
	title: "Tasks/ErrorBanner",
	component: ErrorBanner,
	decorators: [withTasksStyles],
};

export default meta;
type Story = StoryObj<typeof ErrorBanner>;

export const Default: Story = {
	args: {
		task: task(),
	},
};

export const WithMessage: Story = {
	args: {
		task: task({
			current_state: {
				state: "failed",
				message: "Could not calculate the square root of a negative number.",
				timestamp: "2024-06-01T12:00:00Z",
				uri: "",
			},
		}),
	},
};
