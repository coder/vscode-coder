import { NoTemplateState } from "./NoTemplateState";

import { withTasksStyles } from "../utils/storybook";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof NoTemplateState> = {
	title: "Tasks/NoTemplateState",
	component: NoTemplateState,
	decorators: [withTasksStyles],
};

export default meta;
type Story = StoryObj<typeof NoTemplateState>;

export const Default: Story = {};
