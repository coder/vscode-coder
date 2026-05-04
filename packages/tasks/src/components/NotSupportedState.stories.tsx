import { Meta, StoryObj } from "@storybook/react";
import { NotSupportedState } from "./NotSupportedState";

const meta: Meta<typeof NotSupportedState> = {
	title: "Tasks/NotSupportedState",
	component: NotSupportedState,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof NotSupportedState>;

export const Default: Story = {
	args: {},
};
