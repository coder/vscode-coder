import { expect, within } from "storybook/test";

import { FourThemeModes } from "../../storybook";

import { Spinner } from "./Spinner";

import type { Meta, StoryObj } from "@storybook/react-vite";

const SpinnerSizes = (): React.JSX.Element => (
	<div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
		<Spinner size="small" label="Small loading indicator" />
		<Spinner label="Connecting" />
		<Spinner size="large" label="Large loading indicator" />
	</div>
);

const meta: Meta<typeof SpinnerSizes> = {
	title: "UI/Spinner",
	component: SpinnerSizes,
	parameters: { chromatic: { modes: FourThemeModes } },
};
export default meta;
type Story = StoryObj<typeof SpinnerSizes>;

export const Sizes: Story = {
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getAllByRole("status")).toHaveLength(3);
	},
};
