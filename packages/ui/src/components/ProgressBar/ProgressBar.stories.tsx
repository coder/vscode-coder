import { PIXEL_ALL_THEMES } from "#storybook";

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
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof ProgressStates>;

export const States: Story = {};
