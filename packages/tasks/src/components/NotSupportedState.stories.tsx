import { withTasksStyles } from "../utils/storybook";

import { NotSupportedState } from "./NotSupportedState";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof NotSupportedState> = {
	title: "Tasks/NotSupportedState",
	component: NotSupportedState,
	decorators: [withTasksStyles],
};

export default meta;
type Story = StoryObj<typeof NotSupportedState>;

export const Default: Story = {};
