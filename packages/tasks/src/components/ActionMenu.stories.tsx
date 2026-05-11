import { fn } from "storybook/test";

import { ActionMenu } from "./ActionMenu";

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta<typeof ActionMenu> = {
	title: "Tasks/ActionMenu",
	component: ActionMenu,
	args: {
		items: [
			{
				label: "Run Task",
				onClick: fn(),
				icon: "play",
			},
			{
				label: "Configure Task",
				onClick: fn(),
				icon: "settings",
			},
			{
				label: "Delete Task",
				onClick: fn(),
				icon: "trash",
				danger: true,
			},
			{
				label: "Disabled Action",
				onClick: fn(),
				icon: "ban",
				disabled: true,
			},
			{
				separator: true,
			},
			{
				label: "Loading Action",
				onClick: fn(),
				icon: "spinner",
				loading: true,
			},
		],
	},
};

export default meta;
type Story = StoryObj<typeof ActionMenu>;

export const Default: Story = {};
