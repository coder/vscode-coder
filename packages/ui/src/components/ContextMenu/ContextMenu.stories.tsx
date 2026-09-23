import { userEvent, within } from "storybook/test";

import { highlightRow, PIXEL_ALL_THEMES } from "#storybook";

import { MenuExampleItems } from "../Menu/MenuExampleItems";

import {
	ContextMenu,
	ContextMenuContent,
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
		<ContextMenuTrigger
			render={<div style={TARGET_STYLE}>Right-click here</div>}
		/>
		<ContextMenuContent>
			<MenuExampleItems />
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
		await highlightRow("Open logs");
	},
};
