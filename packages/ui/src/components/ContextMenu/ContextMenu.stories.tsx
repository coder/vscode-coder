import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { FOUR_THEME_MODES } from "#storybook";

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "./ContextMenu";

import type { Meta, StoryObj } from "@storybook/react-vite";

const TARGET_STYLE: React.CSSProperties = {
	display: "grid",
	placeItems: "center",
	width: 240,
	height: 120,
	border: "1px dashed var(--ui-description-foreground)",
};

const MenuExample = (): React.JSX.Element => (
	<ContextMenu>
		<ContextMenuTrigger asChild>
			<div style={TARGET_STYLE}>Right-click here</div>
		</ContextMenuTrigger>
		<ContextMenuContent>
			<ContextMenuItem>
				<span className="codicon codicon-play" aria-hidden="true" />
				Start workspace
			</ContextMenuItem>
			<ContextMenuItem>
				<span className="codicon codicon-debug-restart" aria-hidden="true" />
				Restart
			</ContextMenuItem>
			<ContextMenuItem disabled>
				<span className="codicon codicon-stop-circle" aria-hidden="true" />
				Stop
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuSub>
				<ContextMenuSubTrigger>More actions</ContextMenuSubTrigger>
				<ContextMenuSubContent>
					<ContextMenuItem>Open logs</ContextMenuItem>
					<ContextMenuItem>Edit settings</ContextMenuItem>
				</ContextMenuSubContent>
			</ContextMenuSub>
		</ContextMenuContent>
	</ContextMenu>
);

const meta: Meta<typeof MenuExample> = {
	title: "UI/ContextMenu",
	component: MenuExample,
};

export default meta;
type Story = StoryObj<typeof MenuExample>;

/* Right-click at the target's center; without coords the contextmenu
   event fires at (0,0) and the menu opens detached from the target. */
async function rightClickCenter(target: Element): Promise<void> {
	const rect = target.getBoundingClientRect();
	await userEvent.pointer({
		keys: "[MouseRight]",
		target,
		coords: {
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
		},
	});
}

export const Closed: Story = {};

/* Chromatic crops to in-flow content, so snapshot stories reserve space
   for the portalled menu. */
const OVERLAY_SPACE: React.CSSProperties = { width: 620, height: 400 };

/* Opens the menu and its submenu so Chromatic snapshots the open state. */
export const Open: Story = {
	decorators: [
		(Story) => (
			<div style={OVERLAY_SPACE}>
				<Story />
			</div>
		),
	],
	parameters: { chromatic: { modes: FOUR_THEME_MODES } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await rightClickCenter(canvas.getByText("Right-click here"));
		const menu = await screen.findByRole("menu");
		// Radix moves focus into the menu on open
		await waitFor(() =>
			expect(menu.contains(document.activeElement)).toBe(true),
		);
		// Keyboard avoids the submenu hover-open delay
		await userEvent.keyboard("{End}{ArrowRight}");
		await screen.findByRole("menuitem", { name: "Open logs" });
	},
};

export const EscapeClosesMenu: Story = {
	parameters: { chromatic: { disableSnapshot: true } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await rightClickCenter(canvas.getByText("Right-click here"));
		await screen.findByRole("menu");
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
		);
	},
};
