import { screen, userEvent } from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import { Button } from "../Button/Button";

import { Tooltip, TooltipProvider } from "./Tooltip";

import type { Meta, StoryObj } from "@storybook/react-vite";

const LONG_TEXT =
	"This workspace has been running for 14 days without a rebuild. " +
	"Stopping it frees compute resources, and any unsaved changes in " +
	"the home volume are preserved until the next start.";

const meta: Meta<typeof Tooltip> = {
	title: "UI/Tooltip",
	component: Tooltip,
	decorators: [
		// Instant in stories; the provider default is 500ms
		(Story) => (
			<TooltipProvider delayDuration={0}>
				<Story />
			</TooltipProvider>
		),
	],
	args: {
		content: "Stops the workspace",
		children: <Button variant="secondary">Stop</Button>,
	},
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

/* Focusing the trigger skips the pointer show delay. */
async function openTooltipWithKeyboard(): Promise<void> {
	await userEvent.tab();
	await screen.findByRole("tooltip");
}

export const Open: Story = {
	parameters: { pixel: PIXEL_ALL_THEMES },
	play: openTooltipWithKeyboard,
};

/* Shows the wrap at the 700px width cap; maxHeight stands in for the real
   half-window height cap, which is too tall to snapshot. */
export const Overflow: Story = {
	args: {
		content: Array.from({ length: 8 }, () => LONG_TEXT).join(" "),
		style: { maxHeight: 160 },
	},
	play: openTooltipWithKeyboard,
};
