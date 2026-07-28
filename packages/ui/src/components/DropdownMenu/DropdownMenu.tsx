import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cx } from "#cx";

import { Icon } from "../Icon/Icon";
import "../menu.css";
import "../overlay.css";

import type { ComponentPropsWithRef } from "react";

export { MenuKeybinding as DropdownMenuKeybinding } from "../menu";

/** Root state container; wraps the trigger and content. */
export const DropdownMenu = DropdownMenuPrimitive.Root;

/** Opens the menu on click; renders its child element via `asChild`. */
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** Scopes one submenu; wraps its sub trigger and sub content. */
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

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

/** The floating submenu surface, opened by `DropdownMenuSubTrigger`. */
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

/** One selectable action row; a leading `Icon` sits in the gutter. */
export function DropdownMenuItem({
	className,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.Item
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Item
			{...props}
			className={cx("ui-menu__item", className)}
		/>
	);
}

/** A toggleable row; shows the native-style check in the gutter when checked. */
export function DropdownMenuCheckboxItem({
	className,
	children,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.CheckboxItem
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.CheckboxItem
			{...props}
			className={cx("ui-menu__item", className)}
		>
			<DropdownMenuPrimitive.ItemIndicator asChild>
				<Icon name="check" />
			</DropdownMenuPrimitive.ItemIndicator>
			{children}
		</DropdownMenuPrimitive.CheckboxItem>
	);
}

/** Groups `DropdownMenuRadioItem`s into one exclusive selection. */
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

/** One choice in a radio group; native menus check the active choice. */
export function DropdownMenuRadioItem({
	className,
	children,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.RadioItem
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.RadioItem
			{...props}
			className={cx("ui-menu__item", className)}
		>
			<DropdownMenuPrimitive.ItemIndicator asChild>
				<Icon name="check" />
			</DropdownMenuPrimitive.ItemIndicator>
			{children}
		</DropdownMenuPrimitive.RadioItem>
	);
}

/** Non-interactive heading above a group of items. */
export function DropdownMenuLabel({
	className,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.Label
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Label
			{...props}
			className={cx("ui-menu__label", className)}
		/>
	);
}

/** The row that opens its submenu; renders a trailing chevron. */
export function DropdownMenuSubTrigger({
	className,
	children,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.SubTrigger
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.SubTrigger
			{...props}
			className={cx("ui-menu__item", className)}
		>
			{children}
			<Icon name="chevron-right" className="ui-menu__submenu-indicator" />
		</DropdownMenuPrimitive.SubTrigger>
	);
}

/** Thin rule between groups of items. */
export function DropdownMenuSeparator({
	className,
	...props
}: ComponentPropsWithRef<
	typeof DropdownMenuPrimitive.Separator
>): React.JSX.Element {
	return (
		<DropdownMenuPrimitive.Separator
			{...props}
			className={cx("ui-menu__separator", className)}
		/>
	);
}
