import { PIXEL_ALL_THEMES } from "#storybook";

import { Button } from "../Button/Button";

import { EmptyState } from "./EmptyState";

import type { Meta, StoryObj } from "@storybook/react-vite";

const EmptyStates = (): React.JSX.Element => (
	<div style={{ display: "grid", gap: "8px", width: "280px" }}>
		<EmptyState
			title="No workspaces"
			description="Create one to get started."
			action={<Button>Create workspace</Button>}
		/>
		<EmptyState
			icon="search"
			title="No matches"
			description="Try another search."
		/>
	</div>
);

const meta: Meta<typeof EmptyStates> = {
	title: "UI/EmptyState",
	component: EmptyStates,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof EmptyStates>;

export const States: Story = {};
