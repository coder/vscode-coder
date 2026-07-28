import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";

import { cx } from "#cx";

import { Icon } from "../Icon/Icon";
import "../menu.css";
import "../overlay.css";

import type { ComponentPropsWithRef } from "react";

export { MenuKeybinding as ContextMenuKeybinding } from "../menu";

/** Root state container; wraps the trigger and content. */
export const ContextMenu = ContextMenuPrimitive.Root;

/** The right-click target area; renders its child element via `asChild`. */
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

/** Scopes one submenu; wraps its sub trigger and sub content. */
export const ContextMenuSub = ContextMenuPrimitive.Sub;

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

/** The floating submenu surface, opened by `ContextMenuSubTrigger`. */
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

/** One selectable action row; a leading `Icon` sits in the gutter. */
export function ContextMenuItem({
	className,
	...props
}: ComponentPropsWithRef<typeof ContextMenuPrimitive.Item>): React.JSX.Element {
	return (
		<ContextMenuPrimitive.Item
			{...props}
			className={cx("ui-menu__item", className)}
		/>
	);
}

/** A toggleable row; shows the native-style check in the gutter when checked. */
export function ContextMenuCheckboxItem({
	className,
	children,
	...props
}: ComponentPropsWithRef<
	typeof ContextMenuPrimitive.CheckboxItem
>): React.JSX.Element {
	return (
		<ContextMenuPrimitive.CheckboxItem
			{...props}
			className={cx("ui-menu__item", className)}
		>
			<ContextMenuPrimitive.ItemIndicator asChild>
				<Icon name="check" />
			</ContextMenuPrimitive.ItemIndicator>
			{children}
		</ContextMenuPrimitive.CheckboxItem>
	);
}

/** Groups `ContextMenuRadioItem`s into one exclusive selection. */
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

/** One choice in a radio group; native menus check the active choice. */
export function ContextMenuRadioItem({
	className,
	children,
	...props
}: ComponentPropsWithRef<
	typeof ContextMenuPrimitive.RadioItem
>): React.JSX.Element {
	return (
		<ContextMenuPrimitive.RadioItem
			{...props}
			className={cx("ui-menu__item", className)}
		>
			<ContextMenuPrimitive.ItemIndicator asChild>
				<Icon name="check" />
			</ContextMenuPrimitive.ItemIndicator>
			{children}
		</ContextMenuPrimitive.RadioItem>
	);
}

/** Non-interactive heading above a group of items. */
export function ContextMenuLabel({
	className,
	...props
}: ComponentPropsWithRef<
	typeof ContextMenuPrimitive.Label
>): React.JSX.Element {
	return (
		<ContextMenuPrimitive.Label
			{...props}
			className={cx("ui-menu__label", className)}
		/>
	);
}

/** The row that opens its submenu; renders a trailing chevron. */
export function ContextMenuSubTrigger({
	className,
	children,
	...props
}: ComponentPropsWithRef<
	typeof ContextMenuPrimitive.SubTrigger
>): React.JSX.Element {
	return (
		<ContextMenuPrimitive.SubTrigger
			{...props}
			className={cx("ui-menu__item", className)}
		>
			{children}
			<Icon name="chevron-right" className="ui-menu__submenu-indicator" />
		</ContextMenuPrimitive.SubTrigger>
	);
}

/** Thin rule between groups of items. */
export function ContextMenuSeparator({
	className,
	...props
}: ComponentPropsWithRef<
	typeof ContextMenuPrimitive.Separator
>): React.JSX.Element {
	return (
		<ContextMenuPrimitive.Separator
			{...props}
			className={cx("ui-menu__separator", className)}
		/>
	);
}
