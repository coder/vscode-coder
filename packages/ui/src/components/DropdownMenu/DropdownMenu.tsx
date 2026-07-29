import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cx } from "#cx";

import { menuPart } from "../Menu/Menu";
import "../Menu/Menu.css";
import "../overlay.css";

import type { ComponentPropsWithRef } from "react";

export { MenuKeybinding as DropdownMenuKeybinding } from "../Menu/Menu";

/** Root state container. */
export const DropdownMenu = DropdownMenuPrimitive.Root;

/** Opens the menu on click; renders its child element via `asChild`. */
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** Scopes one submenu. */
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

/** Groups radio items into one exclusive selection. */
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

/** One selectable action row; a leading `Icon` sits in the gutter. */
export const DropdownMenuItem = menuPart(
	DropdownMenuPrimitive.Item,
	"ui-menu__item",
);

/** Non-interactive heading above a group. */
export const DropdownMenuLabel = menuPart(
	DropdownMenuPrimitive.Label,
	"ui-menu__label",
);

/** Rule between groups of items. */
export const DropdownMenuSeparator = menuPart(
	DropdownMenuPrimitive.Separator,
	"ui-menu__separator",
);

/** A toggleable row; checked shows a gutter check. */
export const DropdownMenuCheckboxItem = menuPart(
	DropdownMenuPrimitive.CheckboxItem,
	"ui-menu__item",
	{ indicator: DropdownMenuPrimitive.ItemIndicator },
);

/** One choice in a radio group. */
export const DropdownMenuRadioItem = menuPart(
	DropdownMenuPrimitive.RadioItem,
	"ui-menu__item",
	{ indicator: DropdownMenuPrimitive.ItemIndicator },
);

/** The row that opens its submenu. */
export const DropdownMenuSubTrigger = menuPart(
	DropdownMenuPrimitive.SubTrigger,
	"ui-menu__item",
	{ chevron: true },
);

/** The floating menu surface, portalled to `body`. */
export function DropdownMenuContent({
	className,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.Content
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				sideOffset={2}
				align="start"
				// Native menus wrap focus when arrowing past the last item
				loop
				collisionPadding={4}
				{...props}
				className={cx("ui-overlay ui-menu", className)}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

/** The floating submenu surface. */
export function DropdownMenuSubContent({
	className,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.SubContent
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.SubContent
				sideOffset={2}
				loop
				collisionPadding={4}
				{...props}
				className={cx("ui-overlay ui-menu", className)}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}
