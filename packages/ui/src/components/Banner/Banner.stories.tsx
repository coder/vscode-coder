import { PIXEL_ALL_THEMES } from "#storybook";

import { Banner } from "./Banner";

import type { Meta, StoryObj } from "@storybook/react-vite";

const Banners = (): React.JSX.Element => (
	<div style={{ display: "grid", gap: "8px", width: "280px" }}>
		<Banner>A new version of the agent is available.</Banner>
		<Banner severity="warning" actionLabel="Retry" onAction={() => undefined}>
			Couldn't refresh. Showing results from 2:05 PM.
		</Banner>
		<Banner severity="error">
			The deployment rejected the request: a message long enough to wrap onto a
			second line.
		</Banner>
	</div>
);

const meta: Meta<typeof Banners> = {
	title: "UI/Banner",
	component: Banners,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof Banners>;

export const Severities: Story = {};
