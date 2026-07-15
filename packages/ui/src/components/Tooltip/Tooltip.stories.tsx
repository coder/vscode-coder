import { expect, screen, userEvent, waitFor } from "storybook/test";

import {
	overlaySpace,
	PIXEL_ALL_THEMES,
	STORY_TRIGGER_CLASS,
} from "#storybook";

import { Tooltip } from "./Tooltip";

import type { Meta, StoryObj } from "@storybook/react-vite";

const LONG_TEXT =
	"This workspace has been running for 14 days without a rebuild. " +
	"Stopping it frees compute resources, and any unsaved changes in " +
	"the home volume are preserved until the next start.";

const meta: Meta<typeof Tooltip> = {
	title: "UI/Tooltip",
	component: Tooltip,
	args: {
		content: "Stops the workspace",
		// Instant in stories; the component default is 500ms
		delayDuration: 0,
		children: (
			<button type="button" className={STORY_TRIGGER_CLASS}>
				Stop
			</button>
		),
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

export const Closed: Story = {};

/* Keyboard focus opens instantly and proves keyboard users get the tooltip. */
export const Open: Story = {
	decorators: [overlaySpace(280, 100, { anchor: "bottom" })],
	parameters: { pixel: PIXEL_ALL_THEMES },
	play: async () => {
		await openTooltipWithKeyboard();
	},
};

/* Long content wraps inside the native hover widget's max-width. */
export const LongContent: Story = {
	decorators: [overlaySpace(720, 160, { anchor: "bottom" })],
	args: {
		content: LONG_TEXT,
	},
	play: async () => {
		await openTooltipWithKeyboard();
	},
};

/* Overflowing content scrolls inside the tooltip. The default cap is the
   viewport space Radix reports; the story lowers it via style. */
export const OverflowScrolls: Story = {
	decorators: [overlaySpace(720, 240, { anchor: "bottom" })],
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

export const ClosesOnEscape: Story = {
	parameters: { pixel: { exclude: true } },
	play: async () => {
		await openTooltipWithKeyboard();
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
	},
};
