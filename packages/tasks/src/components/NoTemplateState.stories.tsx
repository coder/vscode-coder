import { NoTemplateState } from "./NoTemplateState";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof NoTemplateState> = {
	title: "Tasks/NoTemplateState",
	component: NoTemplateState,
};

export default meta;
type Story = StoryObj<typeof NoTemplateState>;

export const Default: Story = {};
