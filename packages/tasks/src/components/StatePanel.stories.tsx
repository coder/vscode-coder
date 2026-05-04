import type { Meta, StoryObj } from "@storybook/react";
import { StatePanel } from "./StatePanel";

const meta = {
	title: "States/StatePanel",
	component: StatePanel,
	args: {
		title: "Tasks not available",
		description: "This Coder server does not support tasks.",
		action: (
			<a href="/" className="text-link">
				Learn more
			</a>
		),
	},
} satisfies Meta<typeof StatePanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Error: Story = {
	args: {
		className: "error-state",
		description: "Unable to load tasks right now.",
		action: (
			<button type="button" className="text-link">
				Retry
			</button>
		),
	},
};
