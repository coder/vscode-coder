import { Meta, StoryObj } from "@storybook/react";
import { ErrorState } from "./ErrorState";

const meta: Meta<typeof ErrorState> = {
	title: "Tasks/ErrorState",
	component: ErrorState,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {
	args: {
		message: "Task failed",
		onRetry: () => alert("Retrying task..."),
	},
};
