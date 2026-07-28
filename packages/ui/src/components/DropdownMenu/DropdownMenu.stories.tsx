import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import {
	openSubmenuByKeyboard,
	PIXEL_ALL_THEMES,
	STORY_TRIGGER_CLASS,
} from "#storybook";

import { Icon } from "../Icon/Icon";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "./DropdownMenu";

import type { Meta, StoryObj } from "@storybook/react-vite";

const MenuExample = (): React.JSX.Element => (
	<DropdownMenu>
		<DropdownMenuTrigger asChild>
			<button type="button" className={STORY_TRIGGER_CLASS}>
				Workspace actions
			</button>
		</DropdownMenuTrigger>
		<DropdownMenuContent>
			<DropdownMenuItem>
				<Icon name="play" />
				Start workspace
			</DropdownMenuItem>
			<DropdownMenuItem disabled>
				<Icon name="stop-circle" />
				Stop
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuSub>
				<DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger>
				<DropdownMenuSubContent>
					<DropdownMenuItem>Open logs</DropdownMenuItem>
					<DropdownMenuItem>Edit settings</DropdownMenuItem>
				</DropdownMenuSubContent>
			</DropdownMenuSub>
		</DropdownMenuContent>
	</DropdownMenu>
);

const meta: Meta<typeof MenuExample> = {
	title: "UI/DropdownMenu",
	component: MenuExample,
};

export default meta;
type Story = StoryObj<typeof MenuExample>;

export const Open: Story = {
	parameters: { pixel: PIXEL_ALL_THEMES },
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Workspace actions" }),
		);
		await openSubmenuByKeyboard("Open logs");
	},
};

/* Long menus cap to the viewport by default; the story lowers the cap. */
export const ManyItems: Story = {
	render: () => (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button type="button" className={STORY_TRIGGER_CLASS}>
					Workspace actions
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent style={{ maxHeight: 240 }}>
				{Array.from({ length: 40 }, (_, i) => (
					<DropdownMenuItem key={i}>Workspace {i + 1}</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	),
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Workspace actions" }),
		);
		const menu = await screen.findByRole("menu");
		await waitFor(() =>
			expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight),
		);
	},
};
