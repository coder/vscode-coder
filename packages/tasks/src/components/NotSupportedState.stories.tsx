import { NotSupportedState } from "./NotSupportedState";

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta<typeof NotSupportedState> = {
	title: "Tasks/NotSupportedState",
	component: NotSupportedState,
};

export default meta;
type Story = StoryObj<typeof NotSupportedState>;

export const Default: Story = {
	args: {},
};
