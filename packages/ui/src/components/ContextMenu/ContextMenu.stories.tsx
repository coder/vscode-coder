import { userEvent, within } from "storybook/test";

import { openSubmenuByKeyboard, PIXEL_ALL_THEMES } from "#storybook";

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

export const Open: Story = {
	parameters: { pixel: PIXEL_ALL_THEMES },
	play: async ({ canvasElement }) => {
		const target = within(canvasElement).getByText("Right-click here");
		/* Right-click at the target's center; without coords the menu
		   opens at (0,0), detached from the target. */
		const rect = target.getBoundingClientRect();
		await userEvent.pointer({
			keys: "[MouseRight]",
			target,
			coords: {
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2,
			},
		});
		await openSubmenuByKeyboard("Open logs");
	},
};
