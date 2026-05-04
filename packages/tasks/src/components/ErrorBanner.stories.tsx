import { Meta, StoryObj } from "@storybook/react";
import { ErrorBanner } from "./ErrorBanner";
import * as M from "../testHelpers/entities";

const meta: Meta<typeof ErrorBanner> = {
	title: "Tasks/ErrorBanner",
	component: ErrorBanner,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof ErrorBanner>;

export const Default: Story = {
	args: {
		task: M.MockTask,
	},
};

export const WithMessage: Story = {
	args: {
		task: {
			...M.MockTask,
			current_state: {
				state: "failed",
				message: "Could not calculate the square root of a negative number.",
				timestamp: "2024-06-01T12:00:00Z",
				uri: "",
			},
		},
	},
};
