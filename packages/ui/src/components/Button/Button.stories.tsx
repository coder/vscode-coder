import { expect, within } from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import { Button } from "./Button";

import type { Meta, StoryObj } from "@storybook/react-vite";

const ButtonStates = (): React.JSX.Element => (
	<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
		<Button>Start workspace</Button>
		<Button variant="secondary">Open logs</Button>
		<Button disabled>Rebuild</Button>
	</div>
);

const meta: Meta<typeof ButtonStates> = {
	title: "UI/Button",
	component: ButtonStates,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof ButtonStates>;

export const States: Story = {
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole("button", { name: "Rebuild" }),
		).toBeDisabled();
	},
};
