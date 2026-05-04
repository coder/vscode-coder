import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { ActionMenu } from "./ActionMenu";

const meta = {
	title: "Tasks/ActionMenu",
	component: ActionMenu,
	args: {
		items: [
			{
				label: "Run Task",
				onClick: () => alert("Run Task clicked"),
				icon: "play",
			},
			{
				label: "Configure Task",
				onClick: () => alert("Configure Task clicked"),
				icon: "settings",
			},
			{
				label: "Delete Task",
				onClick: () => alert("Delete Task clicked"),
				icon: "trash",
				danger: true,
			},
			{
				label: "Disabled Action",
				onClick: () => alert("This should not be clickable"),
				icon: "ban",
				disabled: true,
			},
			{
				separator: true,
			},
			{
				label: "Loading Action",
				onClick: () => alert("This should show a loading state"),
				icon: "spinner",
				loading: true,
			},
		],
	},
	tags: ["tasks"],
} satisfies Meta<typeof ActionMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Opened: Story = {
	play: async ({ canvasElement }) => {
		// The vscode-icon renders a button in its shadow DOM
		// We need to find the vscode-icon element and click it
		const icon = canvasElement.querySelector("vscode-icon[action-icon]");
		if (icon) {
			await userEvent.click(icon as HTMLElement);
		}
	},
};
