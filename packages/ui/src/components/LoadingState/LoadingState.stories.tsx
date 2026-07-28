import { expect, within } from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import { LoadingState } from "./LoadingState";

import type { Meta, StoryObj } from "@storybook/react-vite";

const LoadingStates = (): React.JSX.Element => (
	<div style={{ display: "grid", gap: "8px", width: "280px" }}>
		<LoadingState title="Loading workspaces" />
		<LoadingState description="Reconnecting to the deployment…" />
	</div>
);

const meta: Meta<typeof LoadingStates> = {
	title: "UI/LoadingState",
	component: LoadingStates,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof LoadingStates>;

export const States: Story = {
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getAllByRole("status")).toHaveLength(2);
	},
};
