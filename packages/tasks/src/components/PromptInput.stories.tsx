import { fn } from "@storybook/test";

import { PromptInput } from "./PromptInput";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof PromptInput> = {
	title: "Tasks/PromptInput",
	component: PromptInput,
	tags: ["tasks"],
	args: {
		value: "",
		onChange: fn(),
		onSubmit: fn(),
		actionIcon: "send",
		actionLabel: "Submit",
		actionEnabled: true,
	},
};

export default meta;
type Story = StoryObj<typeof PromptInput>;

export const Default: Story = {
	args: {
		placeholder: "Enter your prompt here...",
	},
};

export const Loading: Story = {
	args: {
		placeholder: "Loading prompt...",
		loading: true,
	},
};

export const Disabled: Story = {
	args: {
		placeholder: "Prompt input disabled",
		disabled: true,
	},
};
