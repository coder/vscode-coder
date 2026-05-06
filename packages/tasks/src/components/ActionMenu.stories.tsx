import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";

import { ActionMenu } from "./ActionMenu";

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
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof ActionMenu>;

export const Default: Story = {};

export const Opened: Story = {
	play: async ({ canvasElement }) => {
		const icon = canvasElement.querySelector("vscode-icon[action-icon]");
		await expect(icon).toBeTruthy();
		if (!icon) throw new Error("icon not found");
		await userEvent.click(icon);

		const dropdown = canvasElement.querySelector(".action-menu-dropdown");
		await expect(dropdown).toBeTruthy();
	},
};
