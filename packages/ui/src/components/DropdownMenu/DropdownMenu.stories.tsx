import { highlightRow, PIXEL_ALL_THEMES } from "#storybook";

import { Button } from "../Button/Button";
import { MenuItem } from "../Menu/Menu";
import { MenuExampleItems } from "../Menu/MenuExampleItems";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "./DropdownMenu";

import type { Meta, StoryObj } from "@storybook/react-vite";

const MenuExample = (): React.JSX.Element => (
	<DropdownMenu defaultOpen>
		<DropdownMenuTrigger
			render={<Button variant="secondary">Workspace actions</Button>}
		/>
		<DropdownMenuContent>
			<MenuExampleItems />
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
	play: () => highlightRow("Open logs"),
};

/* Long menus cap to the viewport by default; the story lowers the cap. */
export const ManyItems: Story = {
	render: () => (
		<DropdownMenu defaultOpen>
			<DropdownMenuTrigger
				render={<Button variant="secondary">Workspace actions</Button>}
			/>
			<DropdownMenuContent style={{ maxHeight: 240 }}>
				{Array.from({ length: 40 }, (_, i) => (
					<MenuItem key={i}>Workspace {i + 1}</MenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	),
};
