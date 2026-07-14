import { expect, within } from "storybook/test";

import { FourThemeModes } from "../../storybook";

import { ProgressBar } from "./ProgressBar";

import type { Meta, StoryObj } from "@storybook/react-vite";

const ProgressStates = (): React.JSX.Element => (
	<div style={{ display: "grid", gap: "12px", width: "260px" }}>
		<ProgressBar value={42} label="Building workspace" />
		<ProgressBar value={100} label="Complete" />
		<ProgressBar value={3} max={5} label="Custom range" />
		<ProgressBar label="Loading workspace" />
	</div>
);

const meta: Meta<typeof ProgressStates> = {
	title: "UI/ProgressBar",
	component: ProgressStates,
	parameters: { chromatic: { modes: FourThemeModes } },
};
export default meta;
type Story = StoryObj<typeof ProgressStates>;

export const States: Story = {
	play: async ({ canvasElement }) => {
		const progress = within(canvasElement).getByRole("progressbar", {
			name: "Custom range",
		});
		await expect(progress).toHaveAttribute("aria-valuemax", "5");
		await expect(progress).toHaveAttribute("aria-valuenow", "3");
	},
};
