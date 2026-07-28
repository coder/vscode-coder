import { expect, screen, userEvent, waitFor } from "storybook/test";

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

/* findByRole("tooltip") matches Radix's visually hidden a11y copy, so
   open assertions target the visible .ui-tooltip bubble instead. */
async function openTooltipWithKeyboard(): Promise<Element> {
	await userEvent.tab();
	await screen.findByRole("tooltip");
	const tooltip = document.querySelector(".ui-tooltip");
	if (!tooltip) {
		throw new Error("visible tooltip content not found");
	}
	await waitFor(() => expect(tooltip).toBeVisible());
	return tooltip;
}

export const Open: Story = {
	parameters: { pixel: PIXEL_ALL_THEMES },
	play: async () => {
		await openTooltipWithKeyboard();
	},
};

/* Long content wraps at the hover width cap and scrolls once the story
   lowers the height cap. */
export const Overflow: Story = {
	args: {
		content: Array.from({ length: 8 }, () => LONG_TEXT).join(" "),
		style: { maxHeight: 160 },
	},
	play: async () => {
		const tooltip = await openTooltipWithKeyboard();
		await waitFor(() =>
			expect(tooltip.scrollHeight).toBeGreaterThan(tooltip.clientHeight),
		);
	},
};
