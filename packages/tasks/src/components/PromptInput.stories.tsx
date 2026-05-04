import { Meta, StoryObj } from "@storybook/react";
import { PromptInput } from "./PromptInput";

const meta: Meta<typeof PromptInput> = {
	title: "Tasks/PromptInput",
	component: PromptInput,
	tags: ["tasks"],
	args: {
		value: "",
		onChange: () => {},
		onSubmit: () => {},
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
