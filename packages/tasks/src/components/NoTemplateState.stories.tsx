import { Meta, StoryObj } from "@storybook/react";
import { NoTemplateState } from "./NoTemplateState";

const meta: Meta<typeof NoTemplateState> = {
	title: "Tasks/NoTemplateState",
	component: NoTemplateState,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof NoTemplateState>;

export const Default: Story = {};
