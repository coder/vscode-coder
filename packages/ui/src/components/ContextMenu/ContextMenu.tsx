import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";

import { cx } from "#cx";

import { Icon } from "../Icon/Icon";
import "../menu.css";
import "../overlay.css";

import type { ComponentPropsWithRef } from "react";

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
