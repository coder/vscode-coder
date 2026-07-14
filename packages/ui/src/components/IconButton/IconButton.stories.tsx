import { expect, userEvent, within } from "storybook/test";

import { FourThemeModes } from "../../storybook";

import { IconButton } from "./IconButton";

import type { Meta, StoryObj } from "@storybook/react-vite";

const IconButtonStates = (): React.JSX.Element => (
	<div style={{ display: "grid", gap: "8px" }}>
		<span>Toolbar button states</span>
		<div style={{ display: "flex", gap: "8px" }}>
			<IconButton icon="refresh" label="Refresh" />
			<IconButton icon="pin" label="Pinned" aria-pressed="true" />
			<IconButton icon="trash" label="Delete" disabled />
		</div>
	</div>
);

const meta: Meta<typeof IconButtonStates> = {
	title: "UI/IconButton",
	component: IconButtonStates,
	parameters: { chromatic: { modes: FourThemeModes } },
};
export default meta;
type Story = StoryObj<typeof IconButtonStates>;

export const States: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const refreshButton = canvas.getByRole("button", { name: "Refresh" });

		await userEvent.hover(refreshButton);
		refreshButton.focus();
		await expect(refreshButton).toHaveFocus();
		await expect(canvas.getByRole("button", { name: "Delete" })).toBeDisabled();
		refreshButton.blur();
		await userEvent.unhover(refreshButton);
	},
};
