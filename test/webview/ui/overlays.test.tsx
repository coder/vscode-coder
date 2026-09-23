import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type Ref } from "react";
import { describe, expect, it } from "vitest";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSub,
	MenuSubTrigger,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Tooltip,
} from "@repo/ui";

// The CSS reads these, so a rename would otherwise surface only as pixel drift.
const POSITIONER_VARS = [
	"--available-height",
	"--available-width",
	"--anchor-width",
	"--transform-origin",
];

interface Case {
	name: string;
	role: string;
	className: readonly string[];
	ui: (ref: Ref<HTMLDivElement>) => React.JSX.Element;
}

const openMenu = (
	children: React.ReactNode,
	ref?: Ref<HTMLDivElement>,
): React.JSX.Element => (
	<DropdownMenu defaultOpen>
		<DropdownMenuTrigger render={<button type="button">Open</button>} />
		<DropdownMenuContent ref={ref}>{children}</DropdownMenuContent>
	</DropdownMenu>
);

describe("portalled overlays", () => {
	it.each<Case>([
		{
			name: "DropdownMenu",
			role: "menu",
			className: ["ui-overlay", "ui-menu"],
			ui: (ref) => openMenu(<MenuItem>One</MenuItem>, ref),
		},
		{
			name: "Select",
			role: "listbox",
			className: ["ui-overlay", "ui-select__list"],
			ui: (ref) => (
				<Select items={{ a: "Alpha" }} defaultOpen>
					<SelectTrigger aria-label="Pool">
						<SelectValue />
					</SelectTrigger>
					<SelectContent ref={ref}>
						<SelectItem value="a">Alpha</SelectItem>
					</SelectContent>
				</Select>
			),
		},
		{
			name: "Tooltip",
			role: "tooltip",
			className: ["ui-overlay", "ui-tooltip"],
			ui: (ref) => (
				<Tooltip content="Hello" open ref={ref}>
					<button type="button">Trigger</button>
				</Tooltip>
			),
		},
	])(
		"$name forwards props to its $role, dresses its popup, and reports its space to the CSS",
		async ({ role, className, ui }) => {
			const ref = createRef<HTMLDivElement>();
			render(ui(ref));
			const opened = await screen.findByRole(role);
			expect(ref.current).toBe(opened);
			// A select's listbox is the scroller inside the dressed panel.
			const popup = opened.closest(".ui-overlay");
			expect(popup).toHaveClass(...className);
			expect(popup).toHaveAttribute("data-open");
			const positioner = popup?.parentElement?.getAttribute("style") ?? "";
			for (const name of POSITIONER_VARS) {
				expect(positioner).toContain(name);
			}
		},
	);

	it("names a group by its label and highlights an open submenu's row", async () => {
		render(
			openMenu(
				<>
					<MenuRadioGroup value="name">
						<MenuLabel>Sort by</MenuLabel>
						<MenuRadioItem value="name">Name</MenuRadioItem>
					</MenuRadioGroup>
					<MenuSub>
						<MenuSubTrigger>More</MenuSubTrigger>
						<MenuContent>
							<MenuItem>Deep</MenuItem>
						</MenuContent>
					</MenuSub>
				</>,
			),
		);
		expect(await screen.findByRole("group", { name: "Sort by" })).toBeVisible();
		const trigger = screen.getByRole("menuitem", { name: "More" });
		await userEvent.click(trigger);
		expect(await screen.findByRole("menuitem", { name: "Deep" })).toBeVisible();
		expect(trigger).toHaveAttribute("data-popup-open");
	});
});
