import { expect, fn, userEvent } from "@storybook/test";

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
	play: async ({ canvasElement, args }) => {
		const textarea =
			canvasElement.querySelector<HTMLTextAreaElement>(".prompt-input");
		if (!textarea) throw new Error("textarea not found");

		await userEvent.type(textarea, "hello");
		await userEvent.keyboard("{Control>}{Enter}{/Control}");
		await expect(args.onSubmit).toHaveBeenCalledOnce();
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
	play: async ({ canvasElement, args }) => {
		const textarea =
			canvasElement.querySelector<HTMLTextAreaElement>(".prompt-input");
		if (!textarea) throw new Error("textarea not found");

		// The textarea is disabled so userEvent.type won't work; fire the
		// key combo directly and verify onSubmit is never called.
		textarea.focus();
		await userEvent.keyboard("{Control>}{Enter}{/Control}");
		await expect(args.onSubmit).not.toHaveBeenCalled();
	},
};
