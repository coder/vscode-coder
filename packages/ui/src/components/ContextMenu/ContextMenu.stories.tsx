import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { overlaySpace, PIXEL_ALL_THEMES } from "#storybook";

import { Icon } from "../Icon/Icon";

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
				<Icon name="play" />
				Start workspace
			</ContextMenuItem>
			<ContextMenuItem>
				<Icon name="debug-restart" />
				Restart
			</ContextMenuItem>
			<ContextMenuItem disabled>
				<Icon name="stop-circle" />
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

/* Opens the menu and its submenu so Pixel snapshots the open state. */
export const Open: Story = {
	decorators: [overlaySpace(620, 400)],
	parameters: { pixel: PIXEL_ALL_THEMES },
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
	parameters: { pixel: { exclude: true } },
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
