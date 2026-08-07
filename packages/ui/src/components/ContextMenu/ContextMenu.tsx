import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";

import { cx } from "#cx";

import { menuPart } from "../Menu/Menu";
import "../Menu/Menu.css";
import "../overlay.css";

import type { ComponentPropsWithRef } from "react";

export { MenuKeybinding as ContextMenuKeybinding } from "../Menu/Menu";

/** Root state container. */
export const ContextMenu = ContextMenuPrimitive.Root;

/** The right-click target area; renders its child element via `asChild`. */
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

/** Scopes one submenu. */
export const ContextMenuSub = ContextMenuPrimitive.Sub;

/** Groups radio items into one exclusive selection. */
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

/** One selectable action row; a leading `Icon` sits in the gutter. */
export const ContextMenuItem = menuPart(
	ContextMenuPrimitive.Item,
	"ui-menu__item",
);

/** Non-interactive heading above a group. */
export const ContextMenuLabel = menuPart(
	ContextMenuPrimitive.Label,
	"ui-menu__label",
);

/** Rule between groups of items. */
export const ContextMenuSeparator = menuPart(
	ContextMenuPrimitive.Separator,
	"ui-menu__separator",
);

/** A toggleable row; checked shows a gutter check. */
export const ContextMenuCheckboxItem = menuPart(
	ContextMenuPrimitive.CheckboxItem,
	"ui-menu__item",
	{ indicator: ContextMenuPrimitive.ItemIndicator },
);

/** One choice in a radio group. */
export const ContextMenuRadioItem = menuPart(
	ContextMenuPrimitive.RadioItem,
	"ui-menu__item",
	{ indicator: ContextMenuPrimitive.ItemIndicator },
);

/** The row that opens its submenu. */
export const ContextMenuSubTrigger = menuPart(
	ContextMenuPrimitive.SubTrigger,
	"ui-menu__item",
	{ chevron: true },
);

/** The floating menu surface, portalled to `body` at the pointer. */
export function ContextMenuContent({
	className,
	...props
}: ComponentPropsWithRef<
	typeof ContextMenuPrimitive.Content
>): React.JSX.Element {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				// Native menus wrap focus when arrowing past the last item
				loop
				collisionPadding={4}
				{...props}
				className={cx("ui-overlay ui-menu", className)}
			/>
		</ContextMenuPrimitive.Portal>
	);
}

/** The floating submenu surface. */
export function ContextMenuSubContent({
	className,
	...props
}: ComponentPropsWithRef<
	typeof ContextMenuPrimitive.SubContent
>): React.JSX.Element {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.SubContent
				sideOffset={2}
				loop
				collisionPadding={4}
				{...props}
				className={cx("ui-overlay ui-menu", className)}
			/>
		</ContextMenuPrimitive.Portal>
	);
}
