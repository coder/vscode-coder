import { expect, userEvent, within } from "storybook/test";

import { FourThemeModes } from "../storybook";

import { ErrorState } from "./ErrorState";

import type { Meta, StoryObj } from "@storybook/react-vite";

const ErrorStates = (): React.JSX.Element => (
	<div style={{ display: "grid", gap: "8px", width: "280px" }}>
		<ErrorState
			description="We could not load your workspaces."
			onRetry={() => undefined}
		/>
		<ErrorState
			title="Connection failed"
			description="Check your network connection."
			action={<a href="#details">View details</a>}
		/>
	</div>
);

const meta: Meta<typeof ErrorStates> = {
	title: "UI/ErrorState",
	component: ErrorStates,
	parameters: { chromatic: { modes: FourThemeModes } },
};
export default meta;
type Story = StoryObj<typeof ErrorStates>;

export const States: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const retryButton = canvas.getByRole("button", { name: "Try again" });

		await userEvent.hover(retryButton);
		retryButton.focus();
		await expect(retryButton).toHaveFocus();
		retryButton.blur();
		await userEvent.unhover(retryButton);
	},
};
