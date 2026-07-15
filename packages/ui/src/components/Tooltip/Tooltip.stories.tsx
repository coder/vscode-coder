import { expect, screen, userEvent, waitFor } from "storybook/test";

import { FOUR_THEME_MODES, STORY_TRIGGER_CLASS } from "#storybook";

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

/* Chromatic crops to in-flow content; the tooltip opens upward, so the
   wrapper reserves space above a bottom-anchored trigger. */
function tooltipSpace(
	width: number,
	height: number | string,
): (Story: React.ComponentType) => React.JSX.Element {
	const space: React.CSSProperties = {
		width,
		height,
		// Keeps the trigger's focus outline inside the cropped bounds
		paddingBottom: 8,
		display: "flex",
		alignItems: "flex-end",
		justifyContent: "center",
	};
	return function TooltipSpace(Story) {
		return (
			<div style={space}>
				<Story />
			</div>
		);
	};
}

export const Closed: Story = {};

/* Keyboard focus opens instantly and proves keyboard users get the tooltip. */
export const Open: Story = {
	decorators: [tooltipSpace(280, 100)],
	parameters: { chromatic: { modes: FOUR_THEME_MODES } },
	play: async () => {
		await openTooltipWithKeyboard();
	},
};

/* Long content wraps inside the native hover widget's max-width. */
export const LongContent: Story = {
	decorators: [tooltipSpace(720, 160)],
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
	decorators: [tooltipSpace(720, 240)],
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
	parameters: { chromatic: { disableSnapshot: true } },
	play: async () => {
		await userEvent.tab();
		await screen.findByRole("tooltip");
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
	},
};
