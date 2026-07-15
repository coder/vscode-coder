import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { FOUR_THEME_MODES, STORY_TRIGGER_CLASS } from "#storybook";

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
				<span className="codicon codicon-play" aria-hidden="true" />
				Start workspace
			</DropdownMenuItem>
			<DropdownMenuItem>
				<span className="codicon codicon-debug-restart" aria-hidden="true" />
				Restart
			</DropdownMenuItem>
			<DropdownMenuItem disabled>
				<span className="codicon codicon-stop-circle" aria-hidden="true" />
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

export const Closed: Story = {};

/* Chromatic crops to in-flow content, so snapshot stories reserve space
   for the portalled menu. */
const OVERLAY_SPACE: React.CSSProperties = { width: 540, height: 320 };

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
		await userEvent.click(
			canvas.getByRole("button", { name: "Workspace actions" }),
		);
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

/* Long menus scroll. The default cap is the viewport space Radix
   reports; the story lowers it via style. */
export const ManyItems: Story = {
	decorators: [
		(Story) => (
			<div style={{ width: 320, height: 300 }}>
				<Story />
			</div>
		),
	],
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
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Workspace actions" }),
		);
		const menu = await screen.findByRole("menu");
		await waitFor(() =>
			expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight),
		);
	},
};

export const FocusReturnsToTrigger: Story = {
	parameters: { chromatic: { disableSnapshot: true } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const trigger = canvas.getByRole("button", { name: "Workspace actions" });
		await userEvent.click(trigger);
		await screen.findByRole("menu");
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(trigger).toHaveFocus());
		await expect(screen.queryByRole("menu")).not.toBeInTheDocument();
	},
};
