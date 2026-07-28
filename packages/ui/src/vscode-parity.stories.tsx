import {
	VscodeBadge,
	VscodeButton,
	VscodeContextMenu,
	VscodeIcon,
	VscodeProgressBar,
	VscodeProgressRing,
	VscodeTextfield,
	VscodeToolbarButton,
} from "@vscode-elements/react-elements";
import { useState } from "react";
import { screen, userEvent, within } from "storybook/test";

import { Button } from "./components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuKeybinding,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./components/DropdownMenu/DropdownMenu";
import { IconButton } from "./components/IconButton/IconButton";
import { ProgressBar } from "./components/ProgressBar/ProgressBar";
import { SearchInput } from "./components/SearchInput/SearchInput";
import { Spinner } from "./components/Spinner/Spinner";
import { StatusPill } from "./components/StatusPill/StatusPill";
import { PIXEL_ALL_THEMES } from "./storybook";

import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Renders every `@repo/ui` control next to its `@vscode-elements`
 * counterpart under identical theme variables. Pixel snapshots this
 * in all four themes, so any drift from VS Code's appearance shows up as
 * a visual diff.
 */
const Row = ({
	label,
	ours,
	reference,
}: {
	label: string;
	ours: React.ReactNode;
	reference: React.ReactNode;
}): React.JSX.Element => (
	<>
		<div>{label}</div>
		<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
			{ours}
		</div>
		<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
			{reference}
		</div>
	</>
);

/* Stateful like the reference's own toggleable/checked handling */
const PinToggle = (): React.JSX.Element => {
	const [pressed, setPressed] = useState(true);
	return (
		<IconButton
			icon="pinned"
			label="Pinned"
			aria-pressed={pressed}
			onClick={() => setPressed(!pressed)}
		/>
	);
};

const Parity = (): React.JSX.Element => (
	<div
		style={{
			display: "grid",
			gridTemplateColumns: "90px 200px 200px",
			gap: "12px 16px",
			alignItems: "center",
			fontSize: "13px",
		}}
	>
		<Row
			label="Toolbar"
			ours={
				<>
					<IconButton icon="refresh" label="Refresh" />
					<PinToggle />
				</>
			}
			reference={
				<>
					<VscodeToolbarButton icon="refresh" label="Refresh" />
					<VscodeToolbarButton
						icon="pinned"
						label="Pinned"
						toggleable
						checked
					/>
				</>
			}
		/>
		<Row
			label="Search"
			ours={
				<SearchInput
					value="development"
					onChange={() => undefined}
					style={{ width: "180px" }}
				/>
			}
			reference={
				<VscodeTextfield
					type="search"
					value="development"
					style={{ width: "180px" }}
				>
					<VscodeIcon slot="content-before" name="search" />
				</VscodeTextfield>
			}
		/>
		<Row
			label="Button"
			// Narrower than the reference by design: VS Code core's
			// monaco-text-button uses 4px/8px padding; vscode-elements uses 13px.
			ours={
				<>
					<Button>Try again</Button>
					<Button variant="secondary">Cancel</Button>
				</>
			}
			reference={
				<>
					<VscodeButton>Try again</VscodeButton>
					<VscodeButton secondary>Cancel</VscodeButton>
				</>
			}
		/>
		<Row
			label="Link"
			ours={
				<a href="#top" style={{ color: "var(--ui-link-foreground)" }}>
					Learn more
				</a>
			}
			// Styled by the captured VS Code default webview stylesheet.
			reference={<a href="#top">Learn more</a>}
		/>
		<Row
			label="Progress"
			ours={
				<ProgressBar value={42} label="Progress" style={{ width: "180px" }} />
			}
			reference={<VscodeProgressBar value={42} style={{ width: "180px" }} />}
		/>
		<Row
			label="Spinner"
			ours={<Spinner />}
			reference={<VscodeProgressRing />}
		/>
		<Row
			label="Badge"
			// The plain pill matches the native badge; toned pills deliberately
			// diverge into GitHub-style tinted chips.
			ours={
				<>
					<StatusPill>42</StatusPill>
					<StatusPill icon="check" tone="success">
						Running
					</StatusPill>
				</>
			}
			reference={
				<>
					<VscodeBadge variant="counter">42</VscodeBadge>
					<VscodeBadge variant="counter">Running</VscodeBadge>
				</>
			}
		/>
	</div>
);

/* The reference menu renders inline; ours is a real portalled DropdownMenu,
   so the play function opens it under its trigger. */
const MenuParity = (): React.JSX.Element => (
	<div
		style={{
			display: "grid",
			gridTemplateColumns: "220px 220px",
			gap: "16px",
			alignItems: "start",
			fontSize: "13px",
		}}
	>
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="secondary">Menu</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuItem>Start workspace</DropdownMenuItem>
				<DropdownMenuItem>Open logs</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem>
					Rebuild
					<DropdownMenuKeybinding keys="ctrl+shift+r" />
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
		<VscodeContextMenu
			show
			data={[
				{ label: "Start workspace" },
				{ label: "Open logs" },
				{ separator: true },
				{ label: "Rebuild", keybinding: "Ctrl+Shift+R" },
			]}
		/>
	</div>
);

const meta: Meta<typeof Parity> = {
	title: "UI/VSCodeParity",
	component: Parity,
	// rootWidth lets the comparison grid outgrow the 300px sidebar stand-in.
	parameters: { pixel: PIXEL_ALL_THEMES, rootWidth: "max-content" },
};
export default meta;
type Story = StoryObj<typeof Parity>;

export const SideBySide: Story = {};

export const Menu: Story = {
	render: () => <MenuParity />,
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Menu" }),
		);
		await screen.findByRole("menu");
	},
};
